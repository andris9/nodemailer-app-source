# Nodemailer app

### Sendmail in XAMPP-VM

XAMPP Apache uses older libstdc than required, so it needs to be replaced like this

```
$ mv /opt/lampp/lib/libstdc++.so.6 /opt/lampp/lib/libstdc++.so.6.bak
$ cp /usr/lib/x86_64-linux-gnu/libstdc++.so.6 /opt/lampp/lib/
```
