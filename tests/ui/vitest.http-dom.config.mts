import {fileURLToPath} from 'node:url';
export default {root:fileURLToPath(new URL('../../',import.meta.url)),test:{include:['tests/ui/prelaunch-http-dom.test.tsx'],environment:'jsdom',fileParallelism:false}};
