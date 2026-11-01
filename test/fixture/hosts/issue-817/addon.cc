#include <node.h>
namespace host_check {
void Initialize(v8::Local<v8::Object> exports) {
  auto isolate = exports->GetIsolate();
  auto context = isolate->GetCurrentContext();
  exports->Set(context, v8::String::NewFromUtf8(isolate, "answer", v8::NewStringType::kNormal).ToLocalChecked(), v8::Integer::New(isolate, 42)).Check();
  exports->Set(context, v8::String::NewFromUtf8(isolate, "abi", v8::NewStringType::kNormal).ToLocalChecked(), v8::Integer::New(isolate, NODE_MODULE_VERSION)).Check();
}
NODE_MODULE(host_check, Initialize)
}
