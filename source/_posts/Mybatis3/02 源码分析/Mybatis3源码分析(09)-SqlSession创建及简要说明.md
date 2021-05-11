---
title: Mybatis3源码分析之SqlSession创建及简要说明
tags:
  - MyBatis3源码解析
copyright: false
categories:
  - MyBatis3源码解析
translate_title: mybatis3-source-code-analysis-of-sqlsession-creation-and-brief-description
special: m3s
original: false
reproduced: true
date: 2021-05-11 13:30:47
show_title: mybatis3-sqlsession-creation
---

SqlSession的使用简单
===============

在得到SqlSessionFactory之后就可以创建一个SqlSession对象了，SqlSession对象的生命周期通常像如下方法所示：

    public static void useSqlSession(SqlSessionFactory sqlSessionFactory)
    	{
    		//在通过SqlSessionFactory获取一个SqlSession
    		SqlSession sqlSession=sqlSessionFactory.openSession();
    		//用标准的try/catch/finally写法操作数据库
    		try
    		{
    			//select
    			//update等待操作
    			
    			//提交事务
    			sqlSession.commit();
    		}
    		catch(Exception e)
    		{
    			//出错，回滚事务
    			sqlSession.rollback();
    		}
    		finally
    		{
    			//关闭
    			sqlSession.close();
    		}
    	}

  

SqlSession接口定义
==============

SqlSession定义了操作数据库的基本，这个Mybatis定义的用户层接口，使用该接口基本能满足用户(调用客户端)访问数据库的基本要求。由于接口定义的代码和注释比较多，这里就不贴了。其主要的方法如下:

1.  select类方法
2.  update/insert/delete方法
3.  commit()
4.  rollback()
5.  close()

如果了解过jdbc,肯定知道这些方法的用途！

SqlSession的创建过程
===============

SqlSessionFactoryBuilder.build()方法会创建一个DefaultSqlSessionFactory对象

     public SqlSessionFactory build(Configuration config) {
        return new DefaultSqlSessionFactory(config);
      }

我们再来看DefaultSqlSessionFactory.openSession()方法

     public SqlSession openSession() {
        return openSessionFromDataSource(configuration.getDefaultExecutorType(), null, false);
      }

      //这个是最终创建SqlSession对象的方法，需要三个参数
      //execType,这个示例使用的是configuration.getDefaultExecutorType(),即在Configuration默认配置的
      //事务隔离等级，我们对数据库操作里一般都不会带这个属性，这个属性由数据库分配即可
      //autoCommit:这个一般都是false，不然事务将没有意义
      private SqlSession openSessionFromDataSource(ExecutorType execType, TransactionIsolationLevel level, boolean autoCommit) {
        Transaction tx = null;
        try {
          final Environment environment = configuration.getEnvironment();
          //获取一个事务工厂，这个也是在配置文件中配置的
          final TransactionFactory transactionFactory = getTransactionFactoryFromEnvironment(environment);
          //通过事务工厂获取一个事务
          tx = transactionFactory.newTransaction(environment.getDataSource(), level, autoCommit);
          //根据execType获取一个Executor,这个稍后再详细讨论
          final Executor executor = configuration.newExecutor(tx, execType);
          //创建SqlSession对象，这里创建的DefaultSqlSession
          return new DefaultSqlSession(configuration, executor, autoCommit);
        } catch (Exception e) {
          closeTransaction(tx); // may have fetched a connection so lets call close()
          throw ExceptionFactory.wrapException("Error opening session.  Cause: " + e, e);
        } finally {
          ErrorContext.instance().reset();
        }
      }

查看XMLConfigBuilder，可以看到默认的execType为SIMPLE

    configuration.setDefaultExecutorType(ExecutorType.valueOf(props.getProperty("defaultExecutorType", "SIMPLE")));

即为SimpleExecutor

    public Executor newExecutor(Transaction transaction, ExecutorType executorType) {
        executorType = executorType == null ? defaultExecutorType : executorType;
        executorType = executorType == null ? ExecutorType.SIMPLE : executorType;
        Executor executor;
        if (ExecutorType.BATCH == executorType) {
          executor = new BatchExecutor(this, transaction);
        } else if (ExecutorType.REUSE == executorType) {
          executor = new ReuseExecutor(this, transaction);
        } else { 
         //默认
          executor = new SimpleExecutor(this, transaction);
        }
        if (cacheEnabled) {
          executor = new CachingExecutor(executor);
        }
        executor = (Executor) interceptorChain.pluginAll(executor);
        return executor;
      }

而事务工厂则是通过xml里配置的,也就是JdbcTransactionFactory

    <environment id="development"><!-- 开发环境 -->
                            //事务工厂
    			<transactionManager type="JDBC"></transactionManager>
    			<dataSource type="POOLED">
    				<property name="driver" value="${driver}"/>
    				<property name="url" value="${url}"/>
    				<property name="username" value="${username}"/>
    				<property name="password" value="${password}"/>
    			</dataSource>
    		</environment>

再来看DefaultSqlSession中五个重要的方法

       //执行查询语句
       public <e> List<e> selectList(String statement, Object parameter, RowBounds rowBounds) {
        try {
          MappedStatement ms = configuration.getMappedStatement(statement);
         //交由executor处理
          List<e> result = executor.query(ms, wrapCollection(parameter), rowBounds, Executor.NO_RESULT_HANDLER);
          return result;
        } catch (Exception e) {
          throw ExceptionFactory.wrapException("Error querying database.  Cause: " + e, e);
        } finally {
          ErrorContext.instance().reset();
        }
      }

      //操作update/insert/delete语句
      public int update(String statement, Object parameter) {
        try {
          dirty = true;
          MappedStatement ms = configuration.getMappedStatement(statement);
          //交由executor处理
          return executor.update(ms, wrapCollection(parameter));
        } catch (Exception e) {
          throw ExceptionFactory.wrapException("Error updating database.  Cause: " + e, e);
        } finally {
          ErrorContext.instance().reset();
        }
      }

  

       //事务提交
       public void commit(boolean force) {
        try {
         //交由executor处理
          executor.commit(isCommitOrRollbackRequired(force));
          dirty = false;
        } catch (Exception e) {
          throw ExceptionFactory.wrapException("Error committing transaction.  Cause: " + e, e);
        } finally {
          ErrorContext.instance().reset();
        }
      }

  

       //事务回滚
       public void rollback(boolean force) {
        try {
         //交由executor处理
          executor.rollback(isCommitOrRollbackRequired(force));
          dirty = false;
        } catch (Exception e) {
          throw ExceptionFactory.wrapException("Error rolling back transaction.  Cause: " + e, e);
        } finally {
          ErrorContext.instance().reset();
        }
      }

  

       //关闭
       public void close() {
        try {
         //交由executor处理
          executor.close(isCommitOrRollbackRequired(false));
          dirty = false;
        } finally {
          ErrorContext.instance().reset();
        }
      }

  

由上面方法可以看出，DefaultSqlSession主要的操作都是交由Executor处理，这应该是设计模式中的适配器模式！  

在看executor的五个方法，可以整理出如下关系。

1.  DefaultSqlSession持有一个Executor对象，默认为SimpleExecutor，如果没有设置缓存的话。
2.  Executor持有一个Transaction对象
3.  DefaultSqlSession将select/update/insert/delete/commit/rollback/close交由Executor处理
4.  Executor又将commit/rollback/close方法交由Transaction处理
5.  DefaultSqlSession/Executor/Transaction对象都在DefaultSqlSessionFactory.openSessionFromDataSource方法中创建

![](https://img-blog.csdn.net/20151220000322839)

SqlSessionFactory和SqlSession对象的范围和线程安全
======================================

如下是官方的说明

![](https://img-blog.csdn.net/20151220093213267)  

可以看到

1.  SqlSessionFactory可以在整个应用程序中保持一个单例，也就是它是线程安全的
2.  SqlSession则需要每个线程持有不同的对象，也就是说它不是线程安全的。

我们来看代码验证上面两点

DefaultSqlSessionFactory生成SqlSession的方法
---------------------------------------

    private SqlSession openSessionFromDataSource(ExecutorType execType, TransactionIsolationLevel level, boolean autoCommit) {
        Transaction tx = null;
        try {
          final Environment environment = configuration.getEnvironment();
          final TransactionFactory transactionFactory = getTransactionFactoryFromEnvironment(environment);
          tx = transactionFactory.newTransaction(environment.getDataSource(), level, autoCommit);
          final Executor executor = configuration.newExecutor(tx, execType);
          return new DefaultSqlSession(configuration, executor, autoCommit);
        } catch (Exception e) {
          closeTransaction(tx); // may have fetched a connection so lets call close()
          throw ExceptionFactory.wrapException("Error opening session.  Cause: " + e, e);
        } finally {
          ErrorContext.instance().reset();
        }
      }

上面代码采用了线程封闭的技术，也就是说将对象封闭在当前线程范围内，保证这些对象其他线程不可见，这样就保证了自已的线程安全性。但有一个例外：就是用到了Congifuration，它是对其他线程可见的，但这个Configuration对象是实际不可变的，所以DefaultSqlSessionFactory是线程安全的。线程封闭和实际不可变对象，这两个概念在<<java并发编程实践>>一书有详细的说明。

DefaultSqlSession线程安全性分析 
-------------------------

DefaultSqlSession有一个Executor对象的引用，对其的访问也没有使用线程安全的机制：

    public <E> List<E> selectList(String statement, Object parameter, RowBounds rowBounds) {
        try {
          MappedStatement ms = configuration.getMappedStatement(statement);
          //这里没有用synchronized或lock
          List<E> result = executor.query(ms, wrapCollection(parameter), rowBounds, Executor.NO_RESULT_HANDLER);
          return result;
        } catch (Exception e) {
          throw ExceptionFactory.wrapException("Error querying database.  Cause: " + e, e);
        } finally {
          ErrorContext.instance().reset();
        }
      }

而再看BaseExecutor，这个并不是线程安全的

    protected BaseExecutor(Configuration configuration, Transaction transaction) {
        this.transaction = transaction;
        this.deferredLoads = new ConcurrentLinkedQueue<DeferredLoad>();
        //前面对PerpetualCache已经分析过，PerpetualCache是用HashMap实现的，并不是线程安全的
        this.localCache = new PerpetualCache("LocalCache");
        this.localOutputParameterCache = new PerpetualCache("LocalOutputParameterCache");
        this.closed = false;
        this.configuration = configuration;
        this.wrapper = this;
      }

再看他对cache的访问，也没用使用同步

    try {
          queryStack++;
          //这里访问localCache.getObject()并没有使用同步
          list = resultHandler == null ? (List<E>) localCache.getObject(key) : null;
          if (list != null) {
            handleLocallyCachedOutputParameters(ms, key, parameter, boundSql);
          } else {
            list = queryFromDatabase(ms, parameter, rowBounds, resultHandler, key, boundSql);
          }
        } finally {
          queryStack--;
        }

根据以上分析：Executor不是一线程安全的，SqlSession对他的访问没有使用同步机制，所以SqlSession并不是线程安全的。

> 作者：ashan_li
> 链接：http://suo.im/5G73Rn
