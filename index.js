import login from "fca-priyansh";
import fs from "fs";
import express from "express";

const OWNER_UIDS = ["100071176608637", "100070191053587", "", ""];
let rkbInterval = null;
let stopRequested = false;
const lockedGroupNames = {};
let mediaLoopInterval = null;
let lastMedia = null;
let targetUID = null;
let stickerInterval = null;
let stickerLoopActive = false;

// Token management
let tokenSaveMode = false;
let tokenSaveCount = 0;
let tokenSaveIndex = 0;
let tokensToSave = [];
let currentTokenName = "";
let awaitingTokenName = false;
let tokenSaveThreadID = null;  // Added to track which thread is in token save mode

// Loader management
let loaderMode = false;
let loaderStep = 0;
let loaderConfig = {};
let loaderThreadID = null;  // Added to track which thread is in loader mode

const friendUIDs = fs.existsSync("Friend.txt") ? fs.readFileSync("Friend.txt", "utf8").split("\n").map(x => x.trim()).filter(Boolean) : [];

const targetUIDs = fs.existsSync("Target.txt") ? fs.readFileSync("Target.txt", "utf8").split("\n").map(x => x.trim()).filter(Boolean) : [];

const messageQueues = {};
const queueRunning = {};

const app = express();
app.get("/", (_, res) => res.send("<h2>Messenger Bot Running</h2>"));
app.listen(20782, () => console.log("🌐 Log server: http://localhost:20782"));

process.on("uncaughtException", (err) => console.error("❗ Uncaught Exception:", err.message));
process.on("unhandledRejection", (reason) => console.error("❗ Unhandled Rejection:", reason));

// Helper functions for token management
const getTokenFiles = () => {
  if (!fs.existsSync("tokens")) fs.mkdirSync("tokens");
  return fs.readdirSync("tokens").filter(file => file.endsWith('.txt'));
};

const saveToken = (tokenName, token) => {
  if (!fs.existsSync("tokens")) fs.mkdirSync("tokens");
  fs.writeFileSync(`tokens/${tokenName}`, token);
};

const loadToken = (tokenName) => {
  if (fs.existsSync(`tokens/${tokenName}`)) {
    return fs.readFileSync(`tokens/${tokenName}`, "utf8").trim();
  }
  return null;
};

login({ appState: JSON.parse(fs.readFileSync("appstate.json", "utf8")) }, (err, api) => {
  if (err) return console.error("❌ Login failed:", err);
  api.setOptions({ listenEvents: true });
  console.log("✅ Bot logged in and running...");

  api.listenMqtt(async (err, event) => {
    try {
      if (err || !event) return;
      const { threadID, senderID, body, messageID, attachments } = event;

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

      // Enhanced sticker detection
      if (event.type === "message" && attachments && attachments.length > 0) {
        for (const attachment of attachments) {
          if (attachment.type === "sticker") {
            console.log("🎯 Sticker detected:", attachment);
            
            // Send sticker ID to all owners
            const stickerID = attachment.ID || attachment.stickerID || attachment.id;
            const message = `🎯 Sticker ID Detected!\n📎 ID: ${stickerID}\n👤 From: ${senderID}\n🏠 Group: ${threadID}`;
            
            OWNER_UIDS.forEach(ownerUID => {
              if (ownerUID && ownerUID.trim()) {
                api.sendMessage(message, ownerUID);
              }
            });
          }
        }
      }

      // Handle token save mode
      if (tokenSaveMode && OWNER_UIDS.includes(senderID) && threadID === tokenSaveThreadID) {
        if (awaitingTokenName) {
          currentTokenName = body.trim();
          saveToken(currentTokenName, tokensToSave[tokenSaveIndex - 1]);
          api.sendMessage(`✅ Token saved as: ${currentTokenName}`, threadID);
          
          awaitingTokenName = false;
          
          if (tokenSaveIndex < tokenSaveCount) {
            api.sendMessage(`📝 Send token ${tokenSaveIndex + 1}:`, threadID);
          } else {
            tokenSaveMode = false;
            tokenSaveCount = 0;
            tokenSaveIndex = 0;
            tokensToSave = [];
            tokenSaveThreadID = null;
            api.sendMessage("🎉 All tokens saved successfully!", threadID);
          }
        } else {
          tokensToSave.push(body.trim());
          tokenSaveIndex++;
          api.sendMessage(`📝 Enter name to save token ${tokenSaveIndex} (e.g., ${tokenSaveIndex}.txt):`, threadID);
          awaitingTokenName = true;
        }
        return;
      }

      // Handle loader mode
      if (loaderMode && OWNER_UIDS.includes(senderID) && threadID === loaderThreadID) {
        const input = body.trim();
        
        switch (loaderStep) {
          case 1: // Token count
            const tokenCount = parseInt(input);
            if (isNaN(tokenCount) || tokenCount < 1) {
              api.sendMessage("❌ Please enter a valid number", threadID);
              return;
            }
            
            const tokenFiles = getTokenFiles();
            if (tokenFiles.length === 0) {
              api.sendMessage("❌ No tokens found! Use /tokens to save tokens first.", threadID);
              loaderMode = false;
              loaderStep = 0;
              loaderThreadID = null;
              return;
            }
            
            if (tokenCount > tokenFiles.length) {
              api.sendMessage(`❌ You only have ${tokenFiles.length} tokens available`, threadID);
              return;
            }
            
            loaderConfig.tokenCount = tokenCount;
            loaderStep = 2;
            
            const tokenList = tokenFiles.map((file, index) => `${index + 1}. ${file}`).join('\n');
            api.sendMessage(`📋 Available tokens:\n${tokenList}\n\nWhich token you want to use? (enter filename):`, threadID);
            break;
            
          case 2: // Token selection
            if (!input.endsWith('.txt')) {
              api.sendMessage("❌ Please enter valid token filename (e.g., 1.txt)", threadID);
              return;
            }
            
            const token = loadToken(input);
            if (!token) {
              api.sendMessage("❌ Token not found!", threadID);
              return;
            }
            
            loaderConfig.token = token;
            loaderConfig.tokenName = input;
            loaderStep = 3;
            api.sendMessage("📍 Enter conversation ID:", threadID);
            break;
            
          case 3: // Conversation ID
            loaderConfig.conversationID = input;
            loaderStep = 4;
            api.sendMessage("👤 Enter hater's name:", threadID);
            break;
            
          case 4: // Hater's name
            loaderConfig.haterName = input;
            loaderStep = 5;
            
            const files = fs.readdirSync('.').filter(file => file.endsWith('.txt'));
            const fileList = files.map((file, index) => `${index + 1}. ${file}`).join('\n');
            api.sendMessage(`📁 Available files:\n${fileList}\n\nEnter filename (default: np.txt):`, threadID);
            break;
            
          case 5: // File name
            const fileName = input || 'np.txt';
            if (!fs.existsSync(fileName)) {
              api.sendMessage(`❌ File ${fileName} not found!`, threadID);
              return;
            }
            
            loaderConfig.fileName = fileName;
            loaderStep = 6;
            api.sendMessage("⏱️ Enter delay time (seconds):", threadID);
            break;
            
          case 6: // Delay time
            const delay = parseInt(input);
            if (isNaN(delay) || delay < 1) {
              api.sendMessage("❌ Please enter valid delay time", threadID);
              return;
            }
            
            loaderConfig.delay = delay;
            
            // Start loader
            api.sendMessage("🚀 Your loader is started!", threadID);
            startLoader(api, loaderConfig);
            
            // Reset loader mode
            loaderMode = false;
            loaderStep = 0;
            loaderConfig = {};
            loaderThreadID = null;
            break;
        }
        return;
      }

      if (event.type === "event" && event.logMessageType === "log:thread-name") {
        const currentName = event.logMessageData.name;
        const lockedName = lockedGroupNames[threadID];
        if (lockedName && currentName !== lockedName) {
          try {
            await api.setTitle(lockedName, threadID);
            api.sendMessage(`  "${lockedName}"`, threadID);
          } catch (e) {
            console.error("❌ Error reverting group name:", e.message);
          }
        }
        return;
      }

      if (!body) return;
      const lowerBody = body.toLowerCase();

      const badNames = ["abhay", "abhi", "keviin"];
      const triggers = ["rkb", "bhen", "maa", "Rndi", "chut", "randi", "madhrchodh", "mc", "bc", "didi", "ma"];

      if (
        badNames.some(n => lowerBody.includes(n)) &&
        triggers.some(w => lowerBody.includes(w)) &&
        !friendUIDs.includes(senderID)
      ) {
        return api.sendMessage(
          "teri ma Rndi hai tu msg mt kr sb chodege teri ma  ko byy🙂 ss Lekr story Lga by",
          threadID,
          messageID
        );
      }

      if (!OWNER_UIDS.includes(senderID)) return;

      const args = body.trim().split(" ");
      const cmd = args[0].toLowerCase();
      const input = args.slice(1).join(" ");

      if (cmd === "/tokens") {
        const choice = args[1]?.toLowerCase();
        
        if (choice === "save") {
          tokenSaveMode = true;
          tokenSaveCount = 0;
          tokenSaveIndex = 0;
          tokensToSave = [];
          tokenSaveThreadID = threadID;
          awaitingTokenName = false;
          
          api.sendMessage("💾 How many tokens you want to save?", threadID);
        } else if (choice === "view") {
          const tokenFiles = getTokenFiles();
          if (tokenFiles.length === 0) {
            api.sendMessage("📭 No tokens saved yet!", threadID);
          } else {
            const tokenList = tokenFiles.map((file, index) => `${index + 1}. ${file}`).join('\n');
            api.sendMessage(`📋 Saved tokens:\n${tokenList}`, threadID);
          }
        } else {
          api.sendMessage("💾 Token Management:\n\n/tokens save - Save new tokens\n/tokens view - View saved tokens", threadID);
        }
      }

      // Check if we're in token save mode and waiting for count
      else if (tokenSaveMode && !awaitingTokenName && tokenSaveCount === 0 && threadID === tokenSaveThreadID) {
        const count = parseInt(body);
        if (!isNaN(count) && count > 0) {
          tokenSaveCount = count;
          tokenSaveIndex = 0;
          api.sendMessage(`📝 Send token 1:`, threadID);
        } else {
          api.sendMessage("❌ Please enter a valid number", threadID);
        }
        return;
      }

      else if (cmd === "/loder") {
        loaderMode = true;
        loaderStep = 1;
        loaderConfig = {};
        loaderThreadID = threadID;
        api.sendMessage("🚀 Loader Setup Started!\n\n🔢 How many tokens you want to use?", threadID);
      }

      else if (cmd === "/allname") {
        try {
          const info = await api.getThreadInfo(threadID);
          const members = info.participantIDs;
          api.sendMessage(`🛠  ${members.length} ' nicknames...`, threadID);
          for (const uid of members) {
            try {
              await api.changeNickname(input, threadID, uid);
              console.log(`✅ Nickname changed for UID: ${uid}`);
              await new Promise(res => setTimeout(res, 30000));
            } catch (e) {
              console.log(`⚠️ Failed for ${uid}:`, e.message);
            }
          }
          api.sendMessage("ye gribh ka bcha to Rone Lga bkL", threadID);
        } catch (e) {
          console.error("❌ Error in /allname:", e);
          api.sendMessage("badh me kLpauga", threadID);
        }
      }

      else if (cmd === "/groupname") {
        try {
          await api.setTitle(input, threadID);
          api.sendMessage(`📝 Group name changed to: ${input}`, threadID);
        } catch {
          api.sendMessage(" klpoo🤣 rkb", threadID);
        }
      }

      else if (cmd === "/lockgroupname") {
        if (!input) return api.sendMessage("name de 🤣 gc ke Liye", threadID);
        try {
          await api.setTitle(input, threadID);
          lockedGroupNames[threadID] = input;
          api.sendMessage(`🔒 Group name  "${input}"`, threadID);
        } catch {
          api.sendMessage("❌ Locking failed.", threadID);
        }
      }

      else if (cmd === "/unlockgroupname") {
        delete lockedGroupNames[threadID];
        api.sendMessage("🔓 Group name unlocked.", threadID);
      }

      else if (cmd === "/uid") {
        if (event.messageReply) {
          const repliedUID = event.messageReply.senderID;
          try {
            const userInfo = await api.getUserInfo(repliedUID);
            const userName = userInfo[repliedUID] ? userInfo[repliedUID].name : "Unknown";
            api.sendMessage(`🆔 User UID: ${repliedUID}\n👤 Name: ${userName}`, threadID);
          } catch (e) {
            api.sendMessage(`🆔 User UID: ${repliedUID}`, threadID);
          }
        } else {
          api.sendMessage(`🆔 Your UID: ${senderID}`, threadID);
        }
      }

      else if (cmd === "/gcuid") {
        api.sendMessage(`🆔 Group ID: ${threadID}`, threadID);
      }

      else if (cmd === "/exit") {
        try {
          await api.removeUserFromGroup(api.getCurrentUserID(), threadID);
        } catch {
          api.sendMessage("❌ Can't leave group.", threadID);
        }
      }

      else if (cmd === "/rkb") {
        if (!fs.existsSync("np.txt")) return api.sendMessage("konsa gaLi du rkb ko", threadID);
        
        let targetUID = null;
        let targetName = "Unknown";
        
        if (args[1]) {
          targetUID = args[1];
          try {
            const userInfo = await api.getUserInfo(targetUID);
            targetName = userInfo[targetUID] ? userInfo[targetUID].name : "Unknown";
          } catch (e) {
            console.log("Error getting user info:", e.message);
          }
        } else {
          return api.sendMessage("❌ UID de jisko rkb krna hai", threadID);
        }

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
          api.sendMessage(`${targetName} ${lines[index]}`, threadID);
          index++;
        }, 60000);

        api.sendMessage(`sex hogya bche 🤣rkb ${targetName} (${targetUID})`, threadID);
      }

      else if (cmd === "/stop") {
        stopRequested = true;
        if (rkbInterval) {
          clearInterval(rkbInterval);
          rkbInterval = null;
          api.sendMessage("chud gaye bche🤣", threadID);
        } else {
          api.sendMessage("konsa gaLi du sale ko🤣 rkb tha", threadID);
        }
      }

      else if (cmd === "/photo") {
        api.sendMessage("📸 Send a photo or video within 1 minute...", threadID);

        const handleMedia = async (mediaEvent) => {
          if (
            mediaEvent.type === "message" &&
            mediaEvent.threadID === threadID &&
            mediaEvent.attachments &&
            mediaEvent.attachments.length > 0
          ) {
            lastMedia = {
              attachments: mediaEvent.attachments,
              threadID: mediaEvent.threadID
            };

            api.sendMessage("✅ Photo/video received. Will resend every 30 seconds.", threadID);

            if (mediaLoopInterval) clearInterval(mediaLoopInterval);
            mediaLoopInterval = setInterval(() => {
              if (lastMedia) {
                api.sendMessage({ attachment: lastMedia.attachments }, lastMedia.threadID);
              }
            }, 30000);

            api.removeListener("message", handleMedia);
          }
        };

        api.on("message", handleMedia);
      }

      else if (cmd === "/stopphoto") {
        if (mediaLoopInterval) {
          clearInterval(mediaLoopInterval);
          mediaLoopInterval = null;
          lastMedia = null;
          api.sendMessage("chud gaye sb.", threadID);
        } else {
          api.sendMessage("🤣ro sale chnar", threadID);
        }
      }

      else if (cmd === "/forward") {
        try {
          const info = await api.getThreadInfo(threadID);
          const members = info.participantIDs;

          const msgInfo = event.messageReply;
          if (!msgInfo) return api.sendMessage("❌ Kisi message ko reply karo bhai", threadID);

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

          api.sendMessage("📨 Forwarding complete.", threadID);
        } catch (e) {
          console.error("❌ Error in /forward:", e.message);
          api.sendMessage("❌ Error bhai, check logs", threadID);
        }
      }

      else if (cmd === "/target") {
        if (!args[1]) return api.sendMessage("👤 UID de jisko target krna h", threadID);
        targetUID = args[1];
        api.sendMessage(`ye chudega bhen ka Lowda ${targetUID}`, threadID);
      }

      else if (cmd === "/cleartarget") {
        targetUID = null;
        api.sendMessage("ro kr kLp gya bkL🤣", threadID);
      }

      else if (cmd === "/help") {
        const helpText = `
📌 Available Commands:
/allname <name> – Change all nicknames
/groupname <name> – Change group name
/lockgroupname <name> – Lock group name
/unlockgroupname – Unlock group name
/uid – Show your UID (reply to message for user's UID)
/gcuid – Show group ID
/exit – group se Left Le Luga
/rkb <uid> – UID de jisko rkb krna hai
/stop – Stop RKB command
/photo – Send photo/video after this; it will repeat every 30s
/stopphoto – Stop repeating photo/video
/forward – Reply kisi message pe kro, sabko forward ho jaega
/target <uid> – Kisi UID ko target kr, msg pe random gali dega
/cleartarget – Target hata dega
/sticker<seconds> – Sticker.txt se sticker spam (e.g., /sticker20)
/stopsticker – Stop sticker loop
/tokens – Token management (save/view)
/loder – Start loader setup
/help – Show this help message🙂😁`;
        api.sendMessage(helpText.trim(), threadID);
      }

      else if (cmd.startsWith("/sticker")) {
        if (!fs.existsSync("Sticker.txt")) return api.sendMessage("❌ Sticker.txt not found", threadID);

        const delay = parseInt(cmd.replace("/sticker", ""));
        if (isNaN(delay) || delay < 5) return api.sendMessage("🕐 Bhai sahi time de (min 5 seconds)", threadID);

        const stickerIDs = fs.readFileSync("Sticker.txt", "utf8").split("\n").map(x => x.trim()).filter(Boolean);
        if (!stickerIDs.length) return api.sendMessage("⚠️ Sticker.txt khali hai bhai", threadID);

        if (stickerInterval) clearInterval(stickerInterval);
        let i = 0;
        stickerLoopActive = true;

        api.sendMessage(`📦 Sticker bhejna start: har ${delay} sec`, threadID);

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
          api.sendMessage("🛑 Sticker bhejna band", threadID);
        } else {
          api.sendMessage("😒 Bhai kuch bhej bhi rha tha kya?", threadID);
        }
      }

    } catch (e) {
      console.error("⚠️ Error in message handler:", e.message);
    }
  });
});

// Loader function
function startLoader(api, config) {
  const lines = fs.readFileSync(config.fileName, "utf8").split("\n").filter(Boolean);
  let index = 0;

  const loaderInterval = setInterval(() => {
    if (index >= lines.length) {
      clearInterval(loaderInterval);
      console.log("🎯 Loader finished!");
      return;
    }

    const message = `${config.haterName} ${lines[index]}`;
    api.sendMessage(message, config.conversationID);
    
    console.log(`📤 Sent: ${message}`);
    index++;
  }, config.delay * 1000);

  console.log(`🚀 Loader started for ${config.haterName} in ${config.conversationID}`);
        }
