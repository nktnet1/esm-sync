#include <node_api.h>

// A stable Node-API addon keeps this fixture independent of V8's changing ABI.
static napi_value add(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  double left;
  double right;
  napi_value result;

  if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok ||
      argc != 2 ||
      napi_get_value_double(env, args[0], &left) != napi_ok ||
      napi_get_value_double(env, args[1], &right) != napi_ok) {
    napi_throw_type_error(env, NULL, "Expected two numbers");
    return NULL;
  }

  if (napi_create_double(env, left + right, &result) != napi_ok) {
    return NULL;
  }

  return result;
}

NAPI_MODULE_INIT() {
  napi_value function;

  if (napi_create_function(env, "add", NAPI_AUTO_LENGTH, add, NULL, &function) != napi_ok ||
      napi_set_named_property(env, exports, "add", function) != napi_ok) {
    return NULL;
  }

  return exports;
}
