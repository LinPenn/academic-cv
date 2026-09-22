/**
 * 模块：研究方向页面
 * 每个研究方向一个独立页面（content/research/<slug>/），逻辑复用 collectionEditor.js。
 */

import { makeCollectionEditor } from './collectionEditor.js';

export default makeCollectionEditor({
  id: 'researchPages',
  label: '方向页面',
  icon: '📄',
  desc: '每个研究方向一个独立页面：封面、标题、简介与正文。研究页上的卡片会链接到对应页面。',
  apiBase: '/api/research-pages',
  previewBase: '/research/',
  itemName: '方向页面',
  dirHint: 'content/research/<目录>/',
});
