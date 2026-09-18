---
# 作者页策略：默认不生成个人页 —— 论文里的外部作者只在论文条目里显示为文字
# 本组成员由各自的 content/authors/<slug>/_index.md 单独打开（build.render: always）
cascade:
  build:
    render: never
    list: never
---
