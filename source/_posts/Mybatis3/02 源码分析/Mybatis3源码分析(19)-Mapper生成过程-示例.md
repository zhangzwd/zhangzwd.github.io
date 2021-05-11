---
title: Mybatis3源码分析之Mapper生成过程
tags:
  - MyBatis3源码解析
copyright: false
categories:
  - MyBatis3源码解析
translate_title: mapper-generation-process-of-mybatis3-source-code-analysis
special: m3s
original: false
reproduced: true
date: 2021-05-11 15:55:47
show_title: mybatis3-mapper-generation
---

Mybatis提供一种mapper形式的访问接口，通过定义接口，再加上简单的注解就能实现数据库操作。 

下面来看这个mapper是怎么使用的。

先定义接口

    public interface UserDao
    {
            //告诉Mybatis执行什么Sql
    	@Select("select  * from tab_user where user_id=#{USER_ID}")
    	public List<Map<String,Object>> queryUser(Map<String,?> param);
    	
    	
            //也可以这样子设置，Mybatis会调用UserSqlProvider.getQuerySql()方法获取要执行的sql
    	@SelectProvider(
    			type=UserSqlProvider.class,
    			method="getQuerySql"
    	)
    	public List<Map<String,Object>> queryUser_2(Map<String,?> param);
    	
    	public static class UserSqlProvider
    	{
    		public String getQuerySql()
    		{
    			return "select  * from tab_user where user_id=#{USER_ID}";
    		}
    	}
    }

在mybatis-config.xml配置文件中增加配置:

    <mappers>
    		<mapper resource="UserMapper.xml"/>
                     //直接设置class，也可以设置package，让mybatis去描述
    		<mapper class="com.ashan.mybatis.UserDao"/>
    	</mappers>

  

然后就直接可以使用了

    public static void mapperTest(SqlSessionFactory sqlSessionFactory)
    	{
    		SqlSession sqlSession=sqlSessionFactory.openSession();
    		UserDao userDao=sqlSession.getMapper(UserDao.class);
    		System.out.println(userDao);
    		Map<String,Object> param=new HashMap<>();
    		param.put("USER_ID", "user_01");
    		System.out.println(userDao.queryUser_2(param));
    		System.out.println(userDao.queryUser(param));
    	}

输出的结果为

    org.apache.ibatis.binding.MapperProxy@17d99928
    [{user_id=user_01, user_name=liys, cust_id=cust_01, svc_num=13800138000}]
    [{user_id=user_01, user_name=liys, cust_id=cust_01, svc_num=13800138000}]

  
可以看到UserDao对象打印出来为MapperProxy,是一个代理。虽然我们没有实现UserDao接口，但Mybatis为利用JDK的动态代理为我们生成了一个。

接下来的几个章节，分析如下内容： 

1.  Mybatis是怎么读取相关的注解，并加入到Configuration中去的。
2.  Mybatis是怎么生成UserDao的代理对象的。
3.  Mybatis是怎么实现UserDao中的方法的。

> 作者：ashan_li
> 链接：http://suo.im/5G73Rn
