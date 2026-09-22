/**
 * 模块：数据集（资源页上的子页面）
 * 具体逻辑在 collectionEditor.js，这里只提供配置。
 */

import { makeCollectionEditor } from './collectionEditor.js';

export default makeCollectionEditor({
  id: 'resources',
  label: '资源条目',
  icon: '📦',
  desc: '管理资源页上的条目，分「数据库」和「软件与工具」两组；每条有独立页面、封面与正文。',
  apiBase: '/api/resources',
  previewBase: '/resources/',
  itemName: '条目',
  dirHint: 'content/resources/<分组>/<目录>/',
  groups: [
    { value: 'database', label: 'Database（数据库）' },
    { value: 'software', label: 'Software & Tools（软件与工具）' },
  ],
});
