import { Bot } from "grammy";

import { classifyInput } from "./domain/classify-input.js";
import { createInputReply } from "./telegram/input-reply.js";

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
  const input = classifyInput(context.message.text);

  await context.reply(createInputReply(input));
});

process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());

await bot.start({
  onStart: ({ username }) => {
    console.log(`SongDrop is running as @${username}`);
  },
});
