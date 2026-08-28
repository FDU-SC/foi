# 公开仓库的文件

这个目录里的东西**不属于本仓库**，它们是为 `FDU-SC/foi` 准备的。放在这里是为了在拆仓
之前能被审查，同时不会在本仓库触发工作流。

拆仓时的动作是整体替换，不是合并：

```
.opensource/github/       →  .github/          （替换掉现有的整个 .github/）
.opensource/LICENSE       →  LICENSE
.opensource/NOTICE        →  NOTICE
.opensource/README.md.tpl →  README.md
.opensource/SECURITY.md   →  SECURITY.md
```

然后删除 `.opensource/` 本身，以及只服务于内部部署的 `tools/` 与 `DEPLOY.md`。

`docker-compose.example.yml` 与 `.env.example` 不在这里，两个仓库共用同一份。

## 为什么整体替换而不是沿用

现有的 `.github/` 描述的是内部部署架构——目标主机、部署路径、回滚方式、自托管 runner
的构成、镜像仓库的清理策略。这些不进公开仓库。公开仓库需要的只是「能不能编译、能不能
跑起来」，加上 demo 站的每夜重建。

## 拆仓之后

公开仓库删除这几个文件的动作会顺着 `upstream/main` 流回私有仓库，把私有仓库的部署流水线
一并删掉——这是共享历史的必然结果，不是可以绕开的。私有仓库的做法是：接受这次删除，在
**拆仓之后**重新建立自己的部署工作流。此后创建的文件公开仓库从未持有过，也就不会再被
任何合并波及。
