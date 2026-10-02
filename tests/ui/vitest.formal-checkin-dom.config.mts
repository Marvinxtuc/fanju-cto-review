import {fileURLToPath} from 'node:url';
export default {root:fileURLToPath(new URL('../../',import.meta.url)),test:{include:['tests/ui/formal-checkin-http-dom.test.tsx','tests/ui/formal-checkin-qr-native.test.ts'],environment:'jsdom',fileParallelism:false}};
