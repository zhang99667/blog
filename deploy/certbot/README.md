# 生产 TLS 证书续期接线

公网 `80/443` 由 `markz-edge` 终止 TLS，证书文件位于服务器
`/www/server/panel/vhost/cert/39.97.237.248/`，通过
`deploy/docker-compose.edge.yml` 的 `TLS_CERT_ROOT` 只读挂载进容器
`/etc/nginx/ssl`。宝塔面板不再负责这张证书：面板的 `acme_v2.py` 订单只登记了
`jsonutils.markz.fun`，其夜间续期任务因此永远报“没有找到30天内到期的SSL证书”。

真正签发这张多域名证书（`markz.fun`、`www.markz.fun`、`note.markz.fun`、
`jsonutils.markz.fun`、`zhangjihao.markz.fun`、`browser.markz.fun`）的是服务器上的
certbot，lineage 为 `/etc/letsencrypt/live/markz.fun`。

## 续期链路

续期要三个环节同时成立，缺一个就会在到期日直接断站：

1. **定时器在跑**：`certbot-renew.timer`。它只是 `enabled` 并不代表在运行；
   本次事故中该 timer 十个月来一直是 `inactive (dead)`。
2. **HTTP-01 验证通道可用**：`deploy/nginx.conf` 在 80 端口用
   `location ^~ /.well-known/acme-challenge/ { root /var/www/acme; }` 提供
   challenge，宿主机路径为 `/home/markz/apps/blog/acme`。
3. **deploy hook 让 nginx 重新加载**：证书文件更新后 `markz-edge` 仍持有旧证书，
   必须 `nginx -s reload`。

## 已安装的 hook

`renewal-hooks/deploy/markz-tls-deploy.sh` 是仓库内的权威副本，服务器上的
安装路径为 `/etc/letsencrypt/renewal-hooks/deploy/markz-tls-deploy.sh`。修改后
需要重新安装：

```bash
scp deploy/certbot/renewal-hooks/deploy/markz-tls-deploy.sh \
  markz@39.97.237.248:/tmp/markz-tls-deploy.sh
ssh markz@39.97.237.248 \
  'sudo install -o root -g root -m 755 /tmp/markz-tls-deploy.sh \
     /etc/letsencrypt/renewal-hooks/deploy/markz-tls-deploy.sh && rm -f /tmp/markz-tls-deploy.sh'
```

hook 以 root 身份、由 certbot 在签发成功后调用，因此可以用下面的命令单独验证
（幂等：重复安装当前证书并重载 nginx，不会改变证书内容）：

```bash
sudo /etc/letsencrypt/renewal-hooks/deploy/markz-tls-deploy.sh
```

## 检查与恢复

```bash
# 定时器是否真的在跑（只看 enabled 不够，必须确认 Active: active (waiting)）
systemctl status certbot-renew.timer --no-pager
systemctl list-timers certbot-renew.timer

# 证书到期时间与覆盖域名
sudo certbot certificates

# 边缘正在提供的证书
echo | openssl s_client -connect markz.fun:443 -servername markz.fun 2>/dev/null |
  openssl x509 -noout -subject -dates -ext subjectAltName

# 手动续期（到期前或修复接线后）
sudo certbot renew --cert-name markz.fun
```

`npm run smoke:production` 会连接全部六个公开域名，拒绝未通过系统信任校验的
证书，并在剩余有效期低于阈值时失败，因此定时发布链会在到期前两周内报错。
