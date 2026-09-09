import { Bot } from "grammy";

import { createMessageReply } from "./telegram/create-message-reply.js";

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
  await context.reply(await createMessageReply(context.message.text));
});

process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());

await bot.start({
  onStart: ({ username }) => {
    console.log(`SongDrop is running as @${username}`);
  },
});
