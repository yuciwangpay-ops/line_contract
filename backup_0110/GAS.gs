function doPost(e) {
  if (e.postData === undefined) {
    return ContentService.createTextOutput("").setMimeType(ContentService.MimeType.TEXT);
  }

  var params = JSON.parse(e.postData.contents);
  var action = params.action;
  var result;

  if (action === "create_contract") {
    result = createContract(params);
  } else if (action === "get_my_contracts") {
    result = getMyContracts(params);
  } else if (action === "get_contract_details") {
    result = getContractDetails(params);
  } else if (action === "join_contract") {  
    result = joinContract(params);
  }  else if (action === "start_contract") {
    result = startContract(params);
  } else if (action === "log_time") {
    result = logTime(params);
  } else {
    result = ContentService.createTextOutput("Unknown Action");
  }
  
  return result;
}

// 2. 功能：建立新契約 (寫入 Contracts 和 Members 表)
function createContract(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var contractSheet = ss.getSheetByName("Contracts");
  var memberSheet = ss.getSheetByName("Members");
  
  // 生成唯一的契約代碼 (例如: HABIT-1718923...)
  var contractId = "HABIT-" + new Date().getTime().toString().substr(-6); 
  
  // A. 寫入契約主檔 (Contracts)
  // 欄位順序: ID, CreatorID, Name, Desc, Penalty, Duration, Status, StartDate
  contractSheet.appendRow([
    contractId,
    params.userId,
    params.habitName,
    params.description,
    params.penalty,
    params.duration,
    "PENDING", // 預設狀態: 等待中
    ""         // 開始日期: 空白 (等啟動)
  ]);
  
  // B. 把發起人加入成員名單 (Members)
  // 欄位順序: ContractID, UserID, UserName, Role, JoinDate
  memberSheet.appendRow([
    contractId,
    params.userId,
    params.userName,
    "Admin",   // 發起人是管理員
    new Date()
  ]);
  
  // C. 回傳成功訊息與契約ID (讓前端可以做分享連結)
  return ContentService.createTextOutput(JSON.stringify({
    "result": "success",
    "contractId": contractId
  })).setMimeType(ContentService.MimeType.JSON);
}

// === 功能 E: 打卡 (防護罩版：顯示具體錯誤) ===
function logTime(params) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetName = "CheckIns"; // 設定你的表單名稱
    var sheetLogs = ss.getSheetByName(sheetName); 
    
    // 1. 先檢查工作表是否存在？(抓出最常見的錯誤)
    if (!sheetLogs) {
      return ContentService.createTextOutput(JSON.stringify({
        result: "error", 
        message: "嚴重錯誤：找不到工作表 '" + sheetName + "'！請檢查 Excel 下方的標籤名稱是否完全一致（注意大小寫）。"
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    var tz = Session.getScriptTimeZone();
    var todayStr = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
    
    // 2. 檢查是否重複打卡
    var logs = sheetLogs.getDataRange().getValues();
    
    // 如果只有標題列 (長度為1)，就跳過迴圈，避免出錯
    if (logs.length > 1) {
      for (var i = 1; i < logs.length; i++) {
        // 比對 ID (Col B -> index 1) 和 UserID (Col C -> index 2)
        if (String(logs[i][1]) === String(params.contractId) && String(logs[i][2]) === String(params.userId)) {
          
          // 讀取 A欄 (index 0) 的日期
          var logDate = new Date(logs[i][0]); 
          var logDateStr = Utilities.formatDate(logDate, tz, "yyyy-MM-dd");
          
          if (todayStr === logDateStr) {
            return ContentService.createTextOutput(JSON.stringify({
              result: "error", 
              message: "你今天已經打過卡囉！明天再來！👋"
            })).setMimeType(ContentService.MimeType.JSON);
          }
        }
      }
    }

    // 3. 寫入打卡紀錄
    sheetLogs.appendRow([
      new Date(),          // A欄: 時間
      params.contractId,   // B欄: ID
      params.userId,       // C欄: UserID
      params.userName,     // D欄: Name
      "完成"               // E欄: 備註
    ]);
    
    return ContentService.createTextOutput(JSON.stringify({result: "success"}));

  } catch (e) {
    // 4. 捕捉所有未知的程式錯誤，並回傳給前端
    return ContentService.createTextOutput(JSON.stringify({
      result: "error", 
      message: "系統報錯: " + e.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
// 4. 功能：撈出我的 PENDING 契約
function getMyContracts(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Contracts");
  var data = sheet.getDataRange().getValues(); // 抓取所有資料
  
  var myList = [];
  
  // 從第 1 列開始跑 (第 0 列是標題，跳過)
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var contractId = row[0]; // A欄: ID
    var creatorId = row[1];  // B欄: 發起人ID
    var habitName = row[2];  // C欄: 習慣名稱
    var status = row[6];     // G欄: 狀態
    
    // 條件：發起人是我 AND 狀態是 PENDING
    if (creatorId === params.userId && status === "PENDING") {
      myList.push({
        id: contractId,
        name: habitName
      });
    }
  }
  
  return ContentService.createTextOutput(JSON.stringify({
    "result": "success",
    "contracts": myList
  })).setMimeType(ContentService.MimeType.JSON);
}

function joinContract(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetMembers = ss.getSheetByName("Members");
  var sheetContracts = ss.getSheetByName("Contracts");
  
  // 1. 檢查契約是否存在 & 狀態是否為 PENDING
  var contracts = sheetContracts.getDataRange().getValues();
  var contractFound = false;
  for (var i = 1; i < contracts.length; i++) {
    if (contracts[i][0] === params.contractId) {
      if (contracts[i][6] !== "PENDING") {
         return ContentService.createTextOutput(JSON.stringify({result:"error", message:"契約已經開始或結束，無法加入了！"}));
      }
      contractFound = true;
      break;
    }
  }
  if (!contractFound) return ContentService.createTextOutput(JSON.stringify({result:"error", message:"找不到契約"}));

  // 2. 檢查是否已經加入過 (避免重複)
  var members = sheetMembers.getDataRange().getValues();
  for (var j = 1; j < members.length; j++) {
    // 比對 ContractID 和 UserID
    if (String(members[j][0]) === String(params.contractId) && String(members[j][1]) === String(params.userId)) {
       return ContentService.createTextOutput(JSON.stringify({result:"error", message:"你已經在這個契約裡囉！"}));
    }
  }
  
  // 3. 寫入 Members 表，角色為 "Member"
  sheetMembers.appendRow([
    params.contractId,
    params.userId,
    params.userName,
    "Member", // <--- 一般成員
    new Date()
  ]);
  
  return ContentService.createTextOutput(JSON.stringify({result: "success"}));
}
  // === 功能 C: 查詢契約詳情 (包含：檢查今日是否打卡) ===
function getContractDetails(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Contracts");
  var sheetMembers = ss.getSheetByName("Members");
  var sheetLogs = ss.getSheetByName("CheckIns"); // 讀取打卡表
  
  var data = sheet.getDataRange().getValues();
  var targetId = params.contractId;
  
  // 1. 找契約基本資料
  var contractData = null;
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === targetId) {
      contractData = {
        habitName: data[i][2],
        description: data[i][3],
        penalty: data[i][4],
        duration: data[i][5],
        creatorId: data[i][1],
        status: data[i][6]
      };
      break;
    }
  }
  
  if (!contractData) {
    return ContentService.createTextOutput(JSON.stringify({result: "error", message: "找不到契約"}));
  }

  // 2. 找成員名單
  var memberList = [];
  var mData = sheetMembers.getDataRange().getValues();
  for (var j = 1; j < mData.length; j++) {
    if (mData[j][0] === targetId) {
      memberList.push({ name: mData[j][2], role: mData[j][3] });
    }
  }
  
  // 3. [關鍵修正] 檢查「目前使用者」今天是否已打卡
  var isCheckedInToday = false;
  
  if (params.userId && sheetLogs) { 
    var lData = sheetLogs.getDataRange().getValues();
    // 設定台灣時區 GMT+8
    var todayStr = Utilities.formatDate(new Date(), "GMT+8", "yyyy-MM-dd");
    
    // 從第 1 列開始檢查 (避開標題)
    if (lData.length > 1) {
      for (var k = 1; k < lData.length; k++) {
        // 比對：ContractID (B欄 -> index 1) 和 UserID (C欄 -> index 2)
        if (String(lData[k][1]) === String(targetId) && String(lData[k][2]) === String(params.userId)) {
           
           // 比對日期：Timestamp (A欄 -> index 0)
           var rowDate = new Date(lData[k][0]);
           var rowDateStr = Utilities.formatDate(rowDate, "GMT+8", "yyyy-MM-dd");
           
           if (todayStr === rowDateStr) {
             isCheckedInToday = true;
             break; // 找到一筆就算數，不用再找了
           }
        }
      }
    }
  }
  
  return ContentService.createTextOutput(JSON.stringify({
    "result": "success",
    "data": contractData,
    "members": memberList,
    "isCheckedInToday": isCheckedInToday // 回傳 True，前端按鈕才會變灰！
  })).setMimeType(ContentService.MimeType.JSON);
}

function startContract(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Contracts");
  var data = sheet.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === params.contractId) {
      
      // 權限檢查：只有發起人 (B欄) 可以啟動
      if (String(data[i][1]) !== String(params.userId)) {
        return ContentService.createTextOutput(JSON.stringify({result: "error", message: "只有發起人(Admin)可以啟動契約！"}));
      }
      
      // 修改狀態為 RUNNING
      sheet.getRange(i + 1, 7).setValue("RUNNING");
      
      return ContentService.createTextOutput(JSON.stringify({result: "success"}));
    }
  }
  return ContentService.createTextOutput(JSON.stringify({result: "error", message: "找不到契約"}));
}