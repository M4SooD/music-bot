import { Bot } from "grammy";

import { handleMessage } from "./telegram/handle-message.js";

const token = process.env.BOT_TOKEN;

if (!token) {
  throw new Error(
    "BOT_TOKEN is required. Set it in the environment before starting SongDrop.",
  );
}

const bot = new Bot(token);

bot.command("start", async (context) => {
  await context.reply(
    "Welcome to SongDrop! This bot will help you discover and access music from multiple sources.",
  );
});

bot.on("message:text", async (context) => {
  await handleMessage(context.message.text, context);
});

bot.catch(() => {
  // Avoid leaking transport, filesystem, or process details into logs or replies.
  console.error("SongDrop could not finish handling a message.");
});

process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());

await bot.start({
  onStart: ({ username }) => {
    console.log(`SongDrop is running as @${username}`);
  },
});
