/* Authored MIT diagnostic. Preserve the actual fatal signal and emit native frames. */
#define _GNU_SOURCE
#include <execinfo.h>
#include <signal.h>
#include <stdio.h>
#include <unistd.h>

static void trace_crash(int number, siginfo_t *info, void *context) {
  (void)context;
  void *frames[48];
  dprintf(STDERR_FILENO, "NATIVE USB CRASH signal=%d address=%p\n", number, info->si_addr);
  backtrace_symbols_fd(frames, backtrace(frames, 48), STDERR_FILENO);
  kill(getpid(), number);
}

__attribute__((constructor)) static void enable_trace(void) {
  void *frames[1];
  backtrace(frames, 1);
  struct sigaction action = {0};
  action.sa_sigaction = trace_crash;
  action.sa_flags = SA_SIGINFO | SA_RESETHAND;
  sigemptyset(&action.sa_mask);
  sigaction(SIGSEGV, &action, NULL);
}
