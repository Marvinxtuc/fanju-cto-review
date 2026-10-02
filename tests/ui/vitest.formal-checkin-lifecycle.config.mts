import {fileURLToPath} from 'node:url';
export default {root:fileURLToPath(new URL('../../',import.meta.url)),test:{include:['tests/ui/formal-checkin-lifecycle.test.tsx','tests/ui/formal-responsibility-pagination.test.tsx'],environment:'jsdom',fileParallelism:false}};
