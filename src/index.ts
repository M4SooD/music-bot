import { Bot } from "grammy";

const token = process.env.BOT_TOKEN;

if (!token) {
  throw new Error(
    "BOT_TOKEN is required. Set it in the environment before starting Music Bot.",
  );
}

const bot = new Bot(token);

bot.command("start", async (context) => {
  await context.reply(
    "Welcome to Music Bot! This bot will help you discover and access music from multiple sources.",
  );
});

process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());

await bot.start({
  onStart: ({ username }) => {
    console.log(`Music Bot is running as @${username}`);
  },
});
