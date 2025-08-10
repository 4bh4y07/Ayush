import login from "fca-priyansh";
import fs from "fs";
import express from "express";

const OWNER_UIDS = ["100071176608637", "100004559836505", "100028189953672"];
let rkbInterval = null;
let stopRequested = false;
const lockedGroupNames = {};
let targetUID = null;
let stickerInterval = null;
let stickerLoopActive = false;
let autoGcNameInterval = null;
let autoGcNameText = null;
let autoGcNameThreadID = null;

// Ban system
const bannedUIDs = fs.existsSync("Banned.txt") ? fs.readFileSync("Banned.txt", "utf8").split("\n").map(x => x.trim()).filter(Boolean) : [];
const saveBannedUsers = () => fs.writeFileSync("Banned.txt", bannedUIDs.join("\n"));

// Auto reply system
let autoReplyEnabled = {};
const autoReplies = fs.existsSync("AutoReply.json") ? JSON.parse(fs.readFileSync("AutoReply.json", "utf8")) : {};
const saveAutoReplies = () => fs.writeFileSync("AutoReply.json", JSON.stringify(autoReplies, null, 2));

const friendUIDs = fs.existsSync("Friend.txt") ? fs.readFileSync("Friend.txt", "utf8").split("\n").map(x => x.trim()).filter(Boolean) : [];
const targetUIDs = fs.existsSync("Target.txt") ? fs.readFileSync("Target.txt", "utf8").split("\n").map(x => x.trim()).filter(Boolean) : [];

const messageQueues = {};
const queueRunning = {};

const app = express();
app.get("/", (_, res) => res.send("<h2>Messenger Bot Running</h2>"));
app.listen(8083, () => console.log("🌐 Log server: http://localhost:8083"));

process.on("uncaughtException", (err) => console.error("❗ Uncaught Exception:", err.message));
process.on("unhandledRejection", (reason) => console.error("❗ Unhandled Rejection:", reason));

login({ appState: JSON.parse(fs.readFileSync("appstate.json", "utf8")) }, (err, api) => {
  if (err) return console.error("❌ Login failed:", err);
  api.setOptions({ listenEvents: true });
  console.log("✅ Bot logged in and running...");

  api.listenMqtt(async (err, event) => {
    try {
      if (err || !event) return;
      const { threadID, senderID, body, messageID, messageReply } = event;

      const enqueueMessage = (uid, threadID, messageID, api) => {
        if (!messageQueues[uid]) messageQueues[uid] = [];
        messageQueues[uid].push({ threadID, messageID });

        if (queueRunning[uid]) return;
        queueRunning[uid] = true;

        const lines = fs.readFileSync("np.txt", "utf8").split("\n").filter(Boolean);

        const processQueue = async () => {
          if (!messageQueues[uid].length) {
            queueRunning[uid] = false;
            return;
          }

          const msg = messageQueues[uid].shift();
          const randomLine = lines[Math.floor(Math.random() * lines.length)];

          api.sendMessage(randomLine, msg.threadID, msg.messageID);
          setTimeout(processQueue, 20000);
        };

        processQueue();
      };

      if (fs.existsSync("np.txt") && (targetUIDs.includes(senderID) || senderID === targetUID)) {
        enqueueMessage(senderID, threadID, messageID, api);
      }

      if (event.type === "event" && event.logMessageType === "log:thread-name") {
        const currentName = event.logMessageData.name;
        const lockedName = lockedGroupNames[threadID];
        if (lockedName && currentName !== lockedName) {
          try {
            await api.setTitle(lockedName, threadID);
            api.sendMessage(`🔒 Group name reverted to: "${lockedName}"`, threadID);
          } catch (e) {
            console.error("❌ Error reverting group name:", e.message);
          }
        }
        return;
      }

      if (!body) return;
      const lowerBody = body.toLowerCase();

      // Check if user is banned
      if (bannedUIDs.includes(senderID) && !OWNER_UIDS.includes(senderID)) {
        return; // Ignore banned users completely
      }

      // Auto reply system
      if (autoReplyEnabled[threadID] && !OWNER_UIDS.includes(senderID)) {
        for (const keyword in autoReplies) {
          if (lowerBody.includes(keyword.toLowerCase())) {
            api.sendMessage(autoReplies[keyword], threadID, messageID);
            break;
          }
        }
      }

      const badNames = ["abhay", "dev", "hardik", "kevin", "keviin", "abhi", "abhay"];
      const triggers = ["rkb", "bhen", "maa", "Randi", "chut", "randi", "madharchod", "mc", "bc", "didi", "gand"];

      if (
        badNames.some(n => lowerBody.includes(n)) &&
        triggers.some(w => lowerBody.includes(w)) &&
        !friendUIDs.includes(senderID)
      ) {
        return api.sendMessage(
          "teri ma Rndi hai tu msg mt kr sb chodege teri ma ko byy🙂 ss Lekr story Lga by",
          threadID,
          messageID
        );
      }

      if (!OWNER_UIDS.includes(senderID)) return;

      const args = body.trim().split(" ");
      const cmd = args[0].toLowerCase();
      const input = args.slice(1).join(" ");

      if (cmd === "/allname") {
        try {
          const info = await api.getThreadInfo(threadID);
          const members = info.participantIDs;
          api.sendMessage(`🛠 Changing ${members.length} members' nicknames...`, threadID);
          for (const uid of members) {
            try {
              await api.changeNickname(input, threadID, uid);
              console.log(`✅ Nickname changed for UID: ${uid}`);
              await new Promise(res => setTimeout(res, 30000));
            } catch (e) {
              console.log(`⚠️ Failed for ${uid}:`, e.message);
            }
          }
          api.sendMessage("✅ All nicknames changed successfully!", threadID);
        } catch (e) {
          console.error("❌ Error in /allname:", e);
          api.sendMessage("❌ Error changing nicknames", threadID);
        }
      }

      else if (cmd === "/groupname") {
        try {
          await api.setTitle(input, threadID);
          api.sendMessage(`📝 Group name changed to: ${input}`, threadID);
        } catch {
          api.sendMessage("❌ Failed to change group name", threadID);
        }
      }

      else if (cmd === "/lockgroupname") {
        if (!input) return api.sendMessage("❌ Please provide a group name to lock", threadID);
        try {
          await api.setTitle(input, threadID);
          lockedGroupNames[threadID] = input;
          api.sendMessage(`🔒 Group name locked to: "${input}"`, threadID);
        } catch {
          api.sendMessage("❌ Locking failed.", threadID);
        }
      }

      else if (cmd === "/unlockgroupname") {
        delete lockedGroupNames[threadID];
        api.sendMessage("🔓 Group name unlocked.", threadID);
      }

      else if (cmd === "/uid") {
        api.sendMessage(`🆔 Group ID: ${threadID}`, threadID);
      }

      // NEW COMMAND: /ban - Ban a user
      else if (cmd === "/ban") {
        const targetUserId = messageReply ? messageReply.senderID : args[1];
        if (!targetUserId) {
          return api.sendMessage("❌ Reply to someone's message or provide UID to ban", threadID);
        }
        
        if (OWNER_UIDS.includes(targetUserId)) {
          return api.sendMessage("❌ Cannot ban owner/admin", threadID);
        }

        if (!bannedUIDs.includes(targetUserId)) {
          bannedUIDs.push(targetUserId);
          saveBannedUsers();
        }

        try {
          await api.removeUserFromGroup(targetUserId, threadID);
          api.sendMessage(`🚫 User banned and removed from group`, threadID);
        } catch (e) {
          api.sendMessage(`🚫 User banned (couldn't remove from group)`, threadID);
        }
      }

      // NEW COMMAND: /unban - Unban a user
      else if (cmd === "/unban") {
        const targetUserId = args[1];
        if (!targetUserId) {
          return api.sendMessage("❌ Please provide UID to unban", threadID);
        }

        const index = bannedUIDs.indexOf(targetUserId);
        if (index > -1) {
          bannedUIDs.splice(index, 1);
          saveBannedUsers();
          api.sendMessage(`✅ User unbanned`, threadID);
        } else {
          api.sendMessage(`❌ User is not banned`, threadID);
        }
      }

      // NEW COMMAND: /listbanned - Show banned users
      else if (cmd === "/listbanned") {
        if (bannedUIDs.length === 0) {
          api.sendMessage("📋 No banned users", threadID);
        } else {
          api.sendMessage(`🚫 Banned Users (${bannedUIDs.length}):\n${bannedUIDs.join("\n")}`, threadID);
        }
      }

      // NEW COMMAND: /promote - Make user admin
      else if (cmd === "/promote") {
        const targetUserId = messageReply ? messageReply.senderID : args[1];
        if (!targetUserId) {
          return api.sendMessage("❌ Reply to someone's message or provide UID to promote", threadID);
        }

        try {
          await api.changeAdminStatus(threadID, targetUserId, true);
          api.sendMessage(`👑 User promoted to admin`, threadID);
        } catch (e) {
          api.sendMessage(`❌ Failed to promote user: ${e.message}`, threadID);
        }
      }

      // NEW COMMAND: /demote - Remove admin
      else if (cmd === "/demote") {
        const targetUserId = messageReply ? messageReply.senderID : args[1];
        if (!targetUserId) {
          return api.sendMessage("❌ Reply to someone's message or provide UID to demote", threadID);
        }

        if (OWNER_UIDS.includes(targetUserId)) {
          return api.sendMessage("❌ Cannot demote owner", threadID);
        }

        try {
          await api.changeAdminStatus(threadID, targetUserId, false);
          api.sendMessage(`👥 User demoted from admin`, threadID);
        } catch (e) {
          api.sendMessage(`❌ Failed to demote user: ${e.message}`, threadID);
        }
      }

      // NEW COMMAND: /kickall - Kick all members except owners
      else if (cmd === "/kickall") {
        try {
          const info = await api.getThreadInfo(threadID);
          const members = info.participantIDs;
          let kickedCount = 0;

          api.sendMessage(`🚀 Starting to kick ${members.length} members...`, threadID);

          for (const uid of members) {
            if (!OWNER_UIDS.includes(uid) && uid !== api.getCurrentUserID()) {
              try {
                await api.removeUserFromGroup(uid, threadID);
                kickedCount++;
                console.log(`✅ Kicked UID: ${uid}`);
                await new Promise(res => setTimeout(res, 2000)); // 2 second delay
              } catch (e) {
                console.log(`⚠️ Failed to kick ${uid}:`, e.message);
              }
            }
          }

          api.sendMessage(`✅ Kickall completed! Removed ${kickedCount} members`, threadID);
        } catch (e) {
          console.error("❌ Error in /kickall:", e);
          api.sendMessage("❌ Error in kickall command", threadID);
        }
      }

      // NEW COMMAND: /unsend - Delete replied message
      else if (cmd === "/unsend") {
        if (!messageReply) {
          return api.sendMessage("❌ Reply to a message to unsend it", threadID);
        }

        try {
          await api.unsendMessage(messageReply.messageID);
          api.sendMessage("✅ Message deleted", threadID);
        } catch (e) {
          api.sendMessage(`❌ Failed to delete message: ${e.message}`, threadID);
        }
      }

      // AUTO REPLY SYSTEM COMMANDS
      // NEW COMMAND: /autoreply - Enable/disable auto replies
      else if (cmd === "/autoreply") {
        const action = args[1];
        if (action === "on") {
          autoReplyEnabled[threadID] = true;
          api.sendMessage("✅ Auto reply enabled for this group", threadID);
        } else if (action === "off") {
          autoReplyEnabled[threadID] = false;
          api.sendMessage("❌ Auto reply disabled for this group", threadID);
        } else {
          api.sendMessage("Usage: /autoreply on/off", threadID);
        }
      }

      // NEW COMMAND: /setreply - Set auto reply for keyword
      else if (cmd === "/setreply") {
        const parts = input.split(" ");
        if (parts.length < 2) {
          return api.sendMessage("Usage: /setreply <keyword> <response>", threadID);
        }

        const keyword = parts[0];
        const response = parts.slice(1).join(" ");
        
        autoReplies[keyword] = response;
        saveAutoReplies();
        
        api.sendMessage(`✅ Auto reply set:\nKeyword: "${keyword}"\nResponse: "${response}"`, threadID);
      }

      // NEW COMMAND: /removereply - Remove auto reply
      else if (cmd === "/removereply") {
        const keyword = args[1];
        if (!keyword) {
          return api.sendMessage("Usage: /removereply <keyword>", threadID);
        }

        if (autoReplies[keyword]) {
          delete autoReplies[keyword];
          saveAutoReplies();
          api.sendMessage(`✅ Auto reply removed for keyword: "${keyword}"`, threadID);
        } else {
          api.sendMessage(`❌ No auto reply found for keyword: "${keyword}"`, threadID);
        }
      }

      // NEW COMMAND: /listreply - List all auto replies
      else if (cmd === "/listreply") {
        const replies = Object.keys(autoReplies);
        if (replies.length === 0) {
          api.sendMessage("📋 No auto replies set", threadID);
        } else {
          let replyList = "📋 Auto Replies:\n\n";
          for (const keyword of replies) {
            replyList += `🔹 "${keyword}" → "${autoReplies[keyword]}"\n`;
          }
          api.sendMessage(replyList, threadID);
        }
      }
      // NEW COMMAND: /id - Get UID of replied message sender
      else if (cmd === "/id") {
        if (!messageReply) {
          return api.sendMessage("❌ Please reply to someone's message to get their UID", threadID);
        }
        api.sendMessage(`🆔 User ID: ${messageReply.senderID}`, threadID);
      }

      // NEW COMMAND: /autogcname - Auto change group name every 30 seconds
      else if (cmd === "/autogcname") {
        if (!input) {
          return api.sendMessage("❌ Please provide text for auto group name\nUsage: /autogcname your text here", threadID);
        }

        // Stop existing interval if running
        if (autoGcNameInterval) {
          clearInterval(autoGcNameInterval);
        }

        autoGcNameText = input;
        autoGcNameThreadID = threadID;

        api.sendMessage(`✅ Auto group name started: "${input}" will change every 30 seconds`, threadID);

        autoGcNameInterval = setInterval(async () => {
          try {
            await api.setTitle(autoGcNameText, autoGcNameThreadID);
          } catch (e) {
            console.error("❌ Error in auto group name:", e.message);
          }
        }, 30000);
      }

      // Command to stop auto group name
      else if (cmd === "/stopautogcname") {
        if (autoGcNameInterval) {
          clearInterval(autoGcNameInterval);
          autoGcNameInterval = null;
          autoGcNameText = null;
          autoGcNameThreadID = null;
          api.sendMessage("🛑 Auto group name stopped", threadID);
        } else {
          api.sendMessage("❌ Auto group name is not running", threadID);
        }
      }

      // NEW COMMAND: /bkl - Reply to someone's message to abuse them
      else if (cmd === "/bkl") {
        if (!messageReply) {
          return api.sendMessage("❌ Reply kisi ke message pe karo", threadID);
        }

        const abuses = [
          "bhen ka lauda",
          "madarchod",
          "randi ka baccha", 
          "bhosadike",
          "gandu",
          "chutiya",
          "harami",
          "kamine"
        ];

        const randomAbuse = abuses[Math.floor(Math.random() * abuses.length)];
        
        try {
          const userInfo = await api.getUserInfo(messageReply.senderID);
          const userName = userInfo[messageReply.senderID].name;
          
          api.sendMessage(`@${userName} ${randomAbuse} 😂`, threadID, messageID, [{
            tag: userName,
            id: messageReply.senderID
          }]);
        } catch (e) {
          api.sendMessage(`${randomAbuse} 😂`, threadID, messageReply.messageID);
        }
      }

      else if (cmd === "/exit") {
        try {
          await api.removeUserFromGroup(api.getCurrentUserID(), threadID);
        } catch {
          api.sendMessage("❌ Can't leave group.", threadID);
        }
      }

      else if (cmd === "/rkb") {
        if (!fs.existsSync("np.txt")) return api.sendMessage("❌ np.txt file not found", threadID);
        const name = input.trim();
        const lines = fs.readFileSync("np.txt", "utf8").split("\n").filter(Boolean);
        stopRequested = false;

        if (rkbInterval) clearInterval(rkbInterval);
        let index = 0;

        rkbInterval = setInterval(() => {
          if (index >= lines.length || stopRequested) {
            clearInterval(rkbInterval);
            rkbInterval = null;
            return;
          }
          api.sendMessage(`${name} ${lines[index]}`, threadID);
          index++;
        }, 60000);

        api.sendMessage(`🚀 RKB started for ${name}`, threadID);
      }

      else if (cmd === "/stop") {
        stopRequested = true;
        if (rkbInterval) {
          clearInterval(rkbInterval);
          rkbInterval = null;
          api.sendMessage("🛑 RKB stopped", threadID);
        } else {
          api.sendMessage("❌ No RKB running", threadID);
        }
      }

      else if (cmd === "/forward") {
        try {
          const info = await api.getThreadInfo(threadID);
          const members = info.participantIDs;

          const msgInfo = messageReply;
          if (!msgInfo) return api.sendMessage("❌ Reply to a message to forward", threadID);

          for (const uid of members) {
            if (uid !== api.getCurrentUserID()) {
              try {
                await api.sendMessage({
                  body: msgInfo.body || "",
                  attachment: msgInfo.attachments || []
                }, uid);
              } catch (e) {
                console.log(`⚠️ Can't send to ${uid}:`, e.message);
              }
              await new Promise(res => setTimeout(res, 2000));
            }
          }

          api.sendMessage("📨 Message forwarded to all members", threadID);
        } catch (e) {
          console.error("❌ Error in /forward:", e.message);
          api.sendMessage("❌ Error in forwarding", threadID);
        }
      }

      else if (cmd === "/target") {
        if (!args[1]) return api.sendMessage("❌ Please provide UID to target", threadID);
        targetUID = args[1];
        api.sendMessage(`🎯 Target set: ${targetUID}`, threadID);
      }

      else if (cmd === "/cleartarget") {
        targetUID = null;
        api.sendMessage("✅ Target cleared", threadID);
      }

      else if (cmd === "/help") {
        const helpText = `
📌 Available Commands:
/allname <name> – Change all nicknames
/groupname <name> – Change group name
/lockgroupname <name> – Lock group name
/unlockgroupname – Unlock group name
/autogcname <text> – Auto change group name every 30s
/stopautogcname – Stop auto group name
/uid – Show group ID
/id – Reply to message to get user's UID
/bkl – Reply to message to abuse user
/exit – Leave group
/rkb <name> – Start RKB spam
/stop – Stop RKB command
/forward – Reply to message to forward to all
/target <uid> – Target user for auto abuse
/cleartarget – Clear target
/sticker<seconds> – Start sticker spam
/stopsticker – Stop sticker spam
/help – Show this help`;
        api.sendMessage(helpText.trim(), threadID);
      }

      else if (cmd.startsWith("/sticker")) {
        if (!fs.existsSync("Sticker.txt")) return api.sendMessage("❌ Sticker.txt not found", threadID);

        const delay = parseInt(cmd.replace("/sticker", ""));
        if (isNaN(delay) || delay < 5) return api.sendMessage("❌ Please provide valid delay (min 5 seconds)", threadID);

        const stickerIDs = fs.readFileSync("Sticker.txt", "utf8").split("\n").map(x => x.trim()).filter(Boolean);
        if (!stickerIDs.length) return api.sendMessage("❌ Sticker.txt is empty", threadID);

        if (stickerInterval) clearInterval(stickerInterval);
        let i = 0;
        stickerLoopActive = true;

        api.sendMessage(`📦 Sticker spam started: every ${delay} seconds`, threadID);

        stickerInterval = setInterval(() => {
          if (!stickerLoopActive || i >= stickerIDs.length) {
            clearInterval(stickerInterval);
            stickerInterval = null;
            stickerLoopActive = false;
            return;
          }

          api.sendMessage({ sticker: stickerIDs[i] }, threadID);
          i++;
        }, delay * 1000);
      }

      else if (cmd === "/stopsticker") {
        if (stickerInterval) {
          clearInterval(stickerInterval);
          stickerInterval = null;
          stickerLoopActive = false;
          api.sendMessage("🛑 Sticker spam stopped", threadID);
        } else {
          api.sendMessage("❌ No sticker spam running", threadID);
        }
      }

    } catch (e) {
      console.error("⚠️ Error in message handler:", e.message);
    }
  });
});
