import { runComputation } from './compute'
self.onmessage = ({ data: { id, type, payload } }) => {
  try { self.postMessage({ id, result: runComputation(type, payload) }) }
  catch (error) { self.postMessage({ id, error: { name: error.name, message: error.message } }) }
}
