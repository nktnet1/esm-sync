/* Authored MIT control using the exact patched USB queue header. */
#include <nan.h>
#include "uv_async_queue.h"

static Nan::Persistent<v8::Function> callback;
static void delivered(int value);
static UVQueue<int> queue(delivered);

static void delivered(int value) {
  Nan::HandleScope scope;
  v8::Local<v8::Value> args[] = { Nan::New(value) };
  Nan::MakeCallback(Nan::GetCurrentContext()->Global(), Nan::New(callback), 1, args);
  queue.unref();
}

NAN_METHOD(Exercise) {
  callback.Reset(info[0].As<v8::Function>());
  queue.init();
  queue.init();
  queue.ref();
  queue.post(42);
}

NAN_MODULE_INIT(Initialize) { Nan::SetMethod(target, "exercise", Exercise); }
NODE_MODULE(queue_probe, Initialize)
