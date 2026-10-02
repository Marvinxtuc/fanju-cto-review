import {fileURLToPath} from 'node:url';
export default {root:fileURLToPath(new URL('../../',import.meta.url)),test:{include:['tests/ui/formal-core-change-http-dom.test.tsx'],environment:'jsdom',testTimeout:30000,fileParallelism:false}};
