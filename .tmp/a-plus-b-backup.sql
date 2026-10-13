docker : /usr/lib/postgresql/18/bin/pg_dump: unrecognized option '--where=problem_slug='a-plus-b''
所在位置 行:1 字符: 129
+ ... ew($false); docker exec foi-postgres pg_dump -U foi -d foi --data-onl ...
+                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (/usr/lib/postgr...lug='a-plus-b'':String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
pg_dump: hint: Try "pg_dump --help" for more information.
docker : /usr/lib/postgresql/18/bin/pg_dump: unrecognized option '--where=submission_id in (select id from submissions 
where problem_slug='a-plus-b')'
所在位置 行:1 字符: 299
+ ... backup.sql; docker exec foi-postgres pg_dump -U foi -d foi --data-onl ...
+                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (/usr/lib/postgr...ug='a-plus-b')':String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
pg_dump: hint: Try "pg_dump --help" for more information.
docker : /usr/lib/postgresql/18/bin/pg_dump: unrecognized option '--where=slug='a-plus-b''
所在位置 行:1 字符: 534
+ ... backup.sql; docker exec foi-postgres pg_dump -U foi -d foi --data-onl ...
+                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (/usr/lib/postgr...lug='a-plus-b'':String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
pg_dump: hint: Try "pg_dump --help" for more information.
