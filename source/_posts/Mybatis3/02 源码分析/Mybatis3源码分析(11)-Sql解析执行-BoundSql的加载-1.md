---
title: Mybatis3源码分析之BoundSql的加载-1
tags:
  - MyBatis3源码解析
copyright: false
categories:
  - MyBatis3源码解析
translate_title: mybatis3-source-code-analysis-of-boundsql-load---1
special: m3s
original: false
reproduced: true
date: 2021-05-11 13:30:47
show_title: mybatis3-boundsql-1
---

整理完SqlSession和Executor的关系之后，接下来看看一条sql是怎么被解析执行的。

如下例:

    public static void queryUser(SqlSessionFactory sqlSessionFactory)
    	{
    		SqlSession sqlSession=sqlSessionFactory.openSession();
    		try
    		{
    			Map<String,Object> param=new HashMap<>();
    			param.put("userId", "21458594739");
    			//sqlSession.selectList方法就是要详细分析的方法
    			List<User> list=sqlSession.selectList("com.ashan.user.selectUserDetail", param);
    			System.out.println(list);
    			sqlSession.commit();
    		}
    		catch(Exception e)
    		{
    			sqlSession.rollback();
    		}
    		finally
    		{
    			sqlSession.close();
    		}
    	}

  

对应的配置文件:

    <resultMap type="com.ashan.mybatis.User" id="detailUserResultMap">
    		<constructor>
    			<idArg column="user_id" javaType="String"/>
    			<arg column="user_name"/>
    		</constructor>
    		
    		<result property="password" column="user_pwd" />
    		<result property="type" column="user_type" javaType="com.ashan.mybatis.UserType" 
    		       typeHandler="com.ashan.mybatis.UserTypeHandler"/>
    		<result property="svcnum" column="svc_num" /> 
    		<association property="cust" javaType="com.ashan.mybatis.Cust"> 
    			<id property="id" column="cust_id"/>
    			<result property="custname" column="cust_name"/>
    			<result property="certNo" column="cert_no"/>
    		</association>
    		
    		<collection property="accts" ofType="com.ashan.mybatis.Acct">
    			<id property="id" column="acct_id" />
    			<result property="payName" column="pay_name"/>
    			<result property="bankNo" column="bank_no"/>
    		</collection>
    	</resultMap>
    	
    	<select id="selectUserDetail" resultMap="detailUserResultMap">
    		<![CDATA[
    			select user_id,user_name,user_type,cust_id
    				from tf_f_user a 
    				where a.user_id=#${userId} 
    		]]>
    	</select>

DefaultSqlSession.selectList方法
==============================

      public <E> List<E> selectList(String statement, Object parameter) {
        //RowBounds表示查询的范围，一般在分页时用到
        return this.selectList(statement, parameter, RowBounds.DEFAULT);
      }
    
      public <E> List<E> selectList(String statement, Object parameter, RowBounds rowBounds) {
        try { 
          //从Configuration获取一个MappedStatement配置
          MappedStatement ms = configuration.getMappedStatement(statement);
          //直接调用executor.query()方法
          List<E> result = executor.query(ms, wrapCollection(parameter), rowBounds, Executor.NO_RESULT_HANDLER);
          return result;
        } catch (Exception e) {
          throw ExceptionFactory.wrapException("Error querying database.  Cause: " + e, e);
        } finally {
          ErrorContext.instance().reset();
        }
      }

从上可以看到sqlSession.selectList方法非常简单，他是用executor来完成查询的。再看看BaseExecutor对查询的实现:

    public <E> List<E> query(MappedStatement ms, Object parameter, RowBounds rowBounds, ResultHandler resultHandler) throws SQLException {
        //获取一个BoundSql，这个BoundSql的获取过程就是本节要详细讨论的
        BoundSql boundSql = ms.getBoundSql(parameter);
        CacheKey key = createCacheKey(ms, parameter, rowBounds, boundSql);
        return query(ms, parameter, rowBounds, resultHandler, key, boundSql);
     }

BoundSql类定义
===========

如下是BoundSql的源代码

    /**
     * An actual SQL String got form an {@link SqlSource} after having processed any dynamic content.
     * The SQL may have SQL placeholders "?" and an list (ordered) of an parameter mappings 
     * with the additional information for each parameter (at least the property name of the input object to read 
     * the value from). 
     * </br>
     * Can also have additional parameters that are created by the dynamic language (for loops, bind...).
     */
    /**
     * @author Clinton Begin
     */
    public class BoundSql {
      //经过处理的sql,这个sql已经可以被数据库执行了
      private String sql;
      //sql中的参数映射，只是映射，没有包含实际的值
      private List<ParameterMapping> parameterMappings;
      //客户端执行sql时传入的参数
      private Object parameterObject;
     
      //暂时不讨论
      private Map<String, Object> additionalParameters;
      //暂时不讨论
      private MetaObject metaParameters;
    
      public BoundSql(Configuration configuration, String sql, List<ParameterMapping> parameterMappings, Object parameterObject) {
        this.sql = sql;
        this.parameterMappings = parameterMappings;
        this.parameterObject = parameterObject;
        this.additionalParameters = new HashMap<String, Object>();
        this.metaParameters = configuration.newMetaObject(additionalParameters);
      }
    
      public String getSql() {
        return sql;
      }
    
      public List<ParameterMapping> getParameterMappings() {
        return parameterMappings;
      }
    
      public Object getParameterObject() {
        return parameterObject;
      }
    
      public boolean hasAdditionalParameter(String name) {
        return metaParameters.hasGetter(name);
      }
    
      public void setAdditionalParameter(String name, Object value) {
        metaParameters.setValue(name, value);
      }
    
      public Object getAdditionalParameter(String name) {
        return metaParameters.getValue(name);
      }
    }

从源代码可以看出，BoundSql只是一个简单的java对象，有两个属性比较重要

1.  sql:从解析时可以看出这个sql不是配置文件中的sql,这个sql已经经过了处理(如:占用位符的处理、动态语句的解析if、foreach等待)
2.  parameterMappings:sql对应的参数列表

举例:

    <![CDATA[
    			select user_id,user_name,user_type,cust_id
    				from tf_f_user a 
    				where a.user_id=#{userId} 
    		]]>
    		<if test="userName!=null"> 
    			and 
    			user_name=#{userName} 
    		</if>

如果执行这条sql里参数中的userName属性为空，那么sql的值将会是

    select user_id,user_name,user_type,cust_id
    				from tf_f_user a 
    				where a.user_id=?

parameterMappings.size()大小为1，只记录了userId这个参数映射

  

如果userName不为空，那么sql的值将会是

    select user_id,user_name,user_type,cust_id
    				from tf_f_user a 
    				where a.user_id=? 
       and user_name=?

parameterMappings.size()大小为2，记录了userId和userName两个参数映射

MappedStatement.getBoundSql()方法
===============================

    public BoundSql getBoundSql(Object parameterObject) {
        //通过sqlSource对象获取
        BoundSql boundSql = sqlSource.getBoundSql(parameterObject);
       
        //parameterMap一般不会配置，如下内容不讨论
        List<ParameterMapping> parameterMappings = boundSql.getParameterMappings();
        if (parameterMappings == null || parameterMappings.size() <= 0) {
          boundSql = new BoundSql(configuration, boundSql.getSql(), parameterMap.getParameterMappings(), parameterObject);
        }
    
        // check for nested result maps in parameter mappings (issue #30)
        for (ParameterMapping pm : boundSql.getParameterMappings()) {
          String rmId = pm.getResultMapId();
          if (rmId != null) {
            ResultMap rm = configuration.getResultMap(rmId);
            if (rm != null) {
              hasNestedResultMaps |= rm.hasNestedResultMaps();
            }
          }
        }
    
        return boundSql;
      }

还记得sqlSource是怎么被创建的吗？(前面章节有详细说明)

    public SqlSource parseScriptNode() {
        List<SqlNode> contents = parseDynamicTags(context);
        MixedSqlNode rootSqlNode = new MixedSqlNode(contents);
        SqlSource sqlSource = null;
        if (isDynamic) {
          sqlSource = new DynamicSqlSource(configuration, rootSqlNode);
        } else {
          sqlSource = new RawSqlSource(configuration, rootSqlNode, parameterType);
        }
        return sqlSource;
      }

  

DynamicSqlSource.getBoundSql()方法
================================

    public class DynamicSqlSource implements SqlSource {
    
      private Configuration configuration;
      private SqlNode rootSqlNode;
    
      public DynamicSqlSource(Configuration configuration, SqlNode rootSqlNode) {
        this.configuration = configuration;
        this.rootSqlNode = rootSqlNode;
      }
    
      public BoundSql getBoundSql(Object parameterObject) {
        DynamicContext context = new DynamicContext(configuration, parameterObject);
        //sqlNode使用组合模式实现，他有多个SqlNode对象
        //每个SqlNode的apply方法调用时，都为将sql加到context中，最终通过context.getSql()得到完整的sql
        rootSqlNode.apply(context);
        SqlSourceBuilder sqlSourceParser = new SqlSourceBuilder(configuration);
        Class<?> parameterType = parameterObject == null ? Object.class : parameterObject.getClass();
        SqlSource sqlSource = sqlSourceParser.parse(context.getSql(), parameterType, context.getBindings());
        BoundSql boundSql = sqlSource.getBoundSql(parameterObject);
        for (Map.Entry<String, Object> entry : context.getBindings().entrySet()) {
          boundSql.setAdditionalParameter(entry.getKey(), entry.getValue());
        }
        return boundSql;
      }
    
    }

DynamicContext可以看成是一个sql的容器，sqlNode的apply()方法会往这个容器上加sql.

DynamicContext动态上下文  

======================

这个类有两重要的属性

      //参数上下文，ContextMap为一个Map
      private final ContextMap bindings;
      //sql,sqlNode中的apply()方法调用了appendSql(text)方法，最终会将sql保存在这个属性中
      private final StringBuilder sqlBuilder = new StringBuilder();

       public void appendSql(String sql) {
        sqlBuilder.append(sql);
        sqlBuilder.append(" ");
      }
    
      public String getSql() {
        return sqlBuilder.toString().trim();
      }

  
再看看参数上下文

    static class ContextMap extends HashMap<String, Object> {
        private static final long serialVersionUID = 2977601501966151582L;
        //这个对运行时的参数进行了包装
        private MetaObject parameterMetaObject;
        public ContextMap(MetaObject parameterMetaObject) {
          this.parameterMetaObject = parameterMetaObject;
        }
    
        @Override
        public Object put(String key, Object value) {
          return super.put(key, value);
        }
        
    
        //这个方法才是最重要的
        @Override
        public Object get(Object key) {
          String strKey = (String) key;
          //如果自身的map里
          if (super.containsKey(strKey)) {
            return super.get(strKey);
          }
    
          if (parameterMetaObject != null) {
            //从参数里找
            Object object = parameterMetaObject.getValue(strKey);
            // issue #61 do not modify the context when reading
    //        if (object != null) { 
    //          super.put(strKey, object);
    //        }
    
            return object;
          }
    
          return null;
        }

这里举两个例子来说明ContextMap,其中MetaObject将在下一章节详细讨论

1.  参数为Map类型
    
        Map paraMap=new HashMap();
        paraMap.put("userId","12341234");
        paraMap.put("userName","ashan");
        List<User> list=sqlSession.selectList("dao.selectUser",paraMap);
                                                
    
      
    
2.  参数为为一个普通的java对象
    
           
           User user=new User();
        user.setUserId("12341234");
        user.setUserName("ashan");
        					List<User> list=sqlSession.selectList("dao.selectUser",user);
                                                
    

以上两种方式是最常见的参数设置方式，调用ContextMap.get("userId")方法之后，都能得到"12341234"！这就是ContextMap提供的功能。  

SqlSource与SqlNode  

====================

下面详细分析apply()方法。

例如：DynamicSqlSource是从如下配置加载的

    <![CDATA[
    			select user_id,user_name,user_type,cust_id
    				from tf_f_user a 
    				where a.user_id=#{userId} 
    		]]>
    		<if test="userName!=null"> 
    			and 
    			user_name=${userName} 
    		</if>

这个DynamicSqlSoure的结构如下(以上面的SQL为例),

![](https://img-blog.csdn.net/20151221105942363)  

结合例子说明一下sql在sqlNode中是怎么分布的

1.  StaticTextSqlNode1:保存了"select user\_id,user\_name,user\_type,cust\_id"
2.  StaticTextSqlNode2:保存了"from tf\_f\_user a"
3.  TextSqlNode3:保存了"where a.user\_id=#{userId}",同时标识为动态的,因为他有占位符
4.  StaticTextSqlNode4:保存了"and"
5.  TextSqlNode5:保存了"user\_name=#{userName}"
6.  IfSqlNode:保存了其test属性值，StaticTextSqlNode4和TextSqlNode5是否加入的context中也是由其控制的

接下来看看每一种SqlNode是怎么解析sql并生成parameterMapping的

StaticTextSqlNode.apply()方法
===========================

     public boolean apply(DynamicContext context) {
        context.appendSql(text);
        return true;
      }

只是简单的把对应的test追加到context中。

所以StaticTextSqlNode1和StaticTextSqlNode2的apply方法执行后,DynamicContext中的sql内容为:

    select  user_id,user_name,user_type,cust_id from tf_f_user a

  

TextSqlNode.apply()方法
=====================

    public boolean apply(DynamicContext context) {
        //GenericTokenParser为一个占用符解析器
        //BindingTokenParsery为一个TohenHandler:解析具体的占位符
        GenericTokenParser parser = createParser(new BindingTokenParser(context));
        context.appendSql(parser.parse(text));
        return true;
      }

     private GenericTokenParser createParser(TokenHandler handler) {
        //解析${tab_name}这种占位符，注意不是这种#{propertyName}
        return new GenericTokenParser("${", "}", handler);
      }

再看看GenericTokenParser.parse()方法:

    public String parse(String text) {
        StringBuilder builder = new StringBuilder();
        if (text != null && text.length() > 0) {
          char[] src = text.toCharArray();
          int offset = 0;
          int start = text.indexOf(openToken, offset);
          while (start > -1) {
            if (start > 0 && src[start - 1] == '\\') {
              // the variable is escaped. remove the backslash.
              builder.append(src, offset, start - 1).append(openToken);
              offset = start + openToken.length();
            } else {
              int end = text.indexOf(closeToken, start);
              if (end == -1) {
                builder.append(src, offset, src.length - offset);
                offset = src.length;
              } else {
                builder.append(src, offset, start - offset);
                offset = start + openToken.length();
                String content = new String(src, offset, end - offset);
                //关键是这句，调用了handler.handleToken()方法
                builder.append(handler.handleToken(content));
                offset = end + closeToken.length();
              }
            }
            start = text.indexOf(openToken, offset);
          }
          if (offset < src.length) {
            builder.append(src, offset, src.length - offset);
          }
        }
        return builder.toString();
      }

认真分析上面的代码，最关键的是调用了handler.handleToken(content)方法

如果text为:select ${primary\_key},${col\_name} from ${tab\_name)，那么handler.handleToken()方法会被调用三次，分别为：

1.  handler.handleToken("primary\_key")
2.  handler.handleToken("col\_name")
3.  handler.handleToken("tab\_name")

再来看BindingTokenParser.handleToken()方法

    public String handleToken(String content) {
          Object parameter = context.getBindings().get("_parameter");
          if (parameter == null) {
            context.getBindings().put("value", null);
          } else if (SimpleTypeRegistry.isSimpleType(parameter.getClass())) {
            context.getBindings().put("value", parameter);
          }
          //从ContextMap中取出content对应的值返回
          Object value = OgnlCache.getValue(content, context.getBindings());
          return (value == null ? "" : String.valueOf(value)); // issue #274 return "" instead of "null"
        }

从上面可以看到TextSqlNode.apply()，只会处理"${}"这种占位符，而不会处理这种占位符:"#{}"

所以当TextSqlNode3.apply()执行完成之后，DynamicContext中的sql内容为:

    select  user_id,user_name,user_type,cust_id from tf_f_user a where user_id=#{userId}

  

IfSqlNode.apply()方法
===================

      public boolean apply(DynamicContext context) {
        //动态执行test属性中表达式，如果返回true，才会执行对应的SqlNode.apply()方法
        if (evaluator.evaluateBoolean(test, context.getBindings())) {
          contents.apply(context);
          return true;
        }
        return false;`
      }

结合上例，当IfSqlNode.apply()方法执行后，有两种情况：

如果参数中的userName不为空的话,DynamicContext中的sql内容为:

    select  user_id,user_name,user_type,cust_id from tf_f_user a where user_id=#{userId} and user_name=#{userName}

如果参数呻的userName为空的话，DynamicContext中的sql内容为:

    select  user_id,user_name,user_type,cust_id from tf_f_user a where user_id=#{userId}

ForEachSqlNode和ChooseSqlNode的实现原理跟IfSqlNode实现差不多，这里不做讨论!  
  

小结
==

SqlNode.apply()方法生成的sql也只是半成品，并没有处理"#{}"占位符！这个占位符的处理后续再分析。

> 作者：ashan_li
> 链接：http://suo.im/5G73Rn
