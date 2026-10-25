// Each caller supplies the record's checked value type. The record starts empty.
export default function emptyRecord<T extends object>(): T {
  return Object.create(null) as T
}
