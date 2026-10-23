#include <node.h>
#include <uv.h>
#include <v8.h>

namespace esm_sync {

// Each worker has its own loop. Never recursively enter a loop from one of
// the callbacks dispatched by this bridge (uv_run itself is not reentrant).
thread_local bool polling = false;

void Throw(v8::Isolate* isolate, const char* code, const char* message) {
  auto error = v8::Exception::Error(
      v8::String::NewFromUtf8(isolate, message).ToLocalChecked());
  error.As<v8::Object>()
      ->CreateDataProperty(isolate->GetCurrentContext(),
                           v8::String::NewFromUtf8Literal(isolate, "code"),
                           v8::String::NewFromUtf8(isolate, code).ToLocalChecked())
      .Check();
  isolate->ThrowException(error);
}

bool CanPoll(v8::Isolate* isolate) {
  return !polling && !v8::MicrotasksScope::IsRunningMicrotasks(isolate) &&
         node::AsyncHooksGetExecutionAsyncId(isolate) == 1;
}

void Check(const v8::FunctionCallbackInfo<v8::Value>& args) {
  args.GetReturnValue().Set(CanPoll(args.GetIsolate()));
}

void Alive(const v8::FunctionCallbackInfo<v8::Value>& args) {
  uv_loop_t* loop = node::GetCurrentEventLoop(args.GetIsolate());
  args.GetReturnValue().Set(loop != nullptr && uv_loop_alive(loop) != 0);
}

void Poll(const v8::FunctionCallbackInfo<v8::Value>& args) {
  v8::Isolate* isolate = args.GetIsolate();
  uv_loop_t* loop = node::GetCurrentEventLoop(isolate);
  if (!CanPoll(isolate)) {
    Throw(isolate, "ERR_ESM_SYNC_ASYNC_REENTRANT",
          "Cannot poll the event loop from an async callback or microtask");
    return;
  }
  if (loop == nullptr) {
    Throw(isolate, "ERR_ESM_SYNC_ASYNC_PENDING", "No current event loop is available");
    return;
  }

  polling = true;
  uv_run(loop, UV_RUN_NOWAIT);
  polling = false;
  // A bounded sleep avoids a busy spin without letting an unrelated handle
  // make UV_RUN_ONCE block beyond the JavaScript evaluator's deadline.
  uv_sleep(1);
}

NODE_MODULE_INIT(/* exports, module, context */) {
  NODE_SET_METHOD(exports, "canPoll", Check);
  NODE_SET_METHOD(exports, "alive", Alive);
  NODE_SET_METHOD(exports, "poll", Poll);
}

}  // namespace esm_sync
