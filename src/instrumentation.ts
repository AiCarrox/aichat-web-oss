// Next.js 启动钩子:进程启动后挂一个后台 sweep,定期清理过期 guest share 链接相关的数据/文件。
// next 自带的 instrumentation hook,运行在 nodejs runtime 启动一次。
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { sweepExpired } = await import("@/lib/share");
  const { logger } = await import("@/lib/logger");
  const log = logger.child({ module: "instrumentation" });

  const intervalSec = Number(process.env.SHARE_SWEEP_INTERVAL_SEC || 60);
  log.info("sweep.start", { intervalSec });

  const tick = async () => {
    try {
      await sweepExpired();
    } catch (e) {
      log.error("sweep.tick.fail", { error: e });
    }
  };

  // first tick after 5s
  setTimeout(() => {
    void tick();
    setInterval(() => {
      void tick();
    }, intervalSec * 1000);
  }, 5000);
}
