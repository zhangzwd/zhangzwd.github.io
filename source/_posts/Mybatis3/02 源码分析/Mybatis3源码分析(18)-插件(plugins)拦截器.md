---
title: Mybatis3源码分析之插件解析
tags:
  - MyBatis3源码解析
copyright: false
categories:
  - MyBatis3源码解析
translate_title: mybatis3-source-analysis-plug-in-analysis
special: m3s
original: false
reproduced: true
date: 2021-05-11 15:50:47
show_title: mybatis3-plug
---

Mybatis拦截器的使用方法参考官方文档:[http://mybatis.org/mybatis-3/zh/configuration.html#plugins](http://mybatis.org/mybatis-3/zh/configuration.html#plugins)

JDK动态代理示例
=========

Mybatis的拦截器是通过jdk的动态代理实现的，只能生成接口的实例。这里先定义一个接口及实现。

    public interface AshanService
    {
    	public void service(String name);
    }

  

    public class AshanServiceImpl implements AshanService
    {
    
    	@Override
    	public void service(String name)
    	{
    		System.out.println("Hello "+name);
    	}
    
    }

  

JDK实现动态代理

    public class JdkDynamicProxy
    {
    
    	public static void main(String[] args)
    	{
    		//JDK动态代码要求实现InvocationHandler
    		class AshanInvocationHandler implements InvocationHandler
    		{
    			
    			private Object target;
    			
    			public AshanInvocationHandler(Object obj)
    			{
    				
    				this.target=obj;
    			}
    
    			@Override
    			public Object invoke(Object proxy, Method method, Object[] args)
    					throws Throwable
    			{
    				System.out.println("jdk dynamic proxy before..");
    				Object ret=method.invoke(this.target, args);
    				System.out.println("jdk dynamic proxy after..");
    				return ret;
    			}
    		}
    		
    		
    		AshanService service=new AshanServiceImpl();
    		AshanInvocationHandler handler=new AshanInvocationHandler(service);
    		
    		//利用proxy生成一个代理对象
    		AshanService proxy=(AshanService)Proxy.newProxyInstance(service.getClass().getClassLoader(), service.getClass().getInterfaces(), handler);
    		proxy.service("jdk dynamic proxy");
    
    	}
    
    }

  
输出内容为

    jdk dynamic proxy before..
    Hello jdk dynamic proxy
    jdk dynamic proxy after..

  
  

Mybatis中的拦截器示例
==============

    //这个注解会被Plugin读取
    @Intercepts
    (
    		{
    			@Signature//定义方法签名
    			(
    					type=AshanService.class,
    					method="service",
    					args={String.class}
    			)
    		}
    )
    public class AshanInterceptor implements Interceptor
    {
    	
    	private String name="";
    	
    	public AshanInterceptor(String name)
    	{
    		super();
    		this.name = name;
    	}
    
    	//只有Intercepts在定义的方法才会被拦截
    	@Override
    	public Object intercept(Invocation invocation) throws Throwable
    	{
    		System.out.println("AshanInterceptor["+name+"]...before...");
    		Object obj=invocation.proceed();
    		System.out.println("AshanInterceptor["+name+"]...after...");
    		return obj;
    	}
    
    	@Override
    	public Object plugin(Object target)
    	{
    		if(target!=null && target instanceof AshanService)
    		{
    			//Plugin是mybatis提供的
    			return Plugin.wrap(target, this);
    		}
    		return target;
    	}
    
    	@Override
    	public void setProperties(Properties properties)
    	{
    		
    	}
    	
    	public static void main(String[] args)
    	{
    		AshanService service=new AshanServiceImpl();
    		AshanInterceptor aiNoName=new AshanInterceptor("no_name");
    		//直接用Interceptor.plugin生成一个代理
    		AshanService proxy1=(AshanService)aiNoName.plugin(service);
    		proxy1.service("ashan");
    		
    		
    		System.out.println("######################");
    		
    		InterceptorChain chain=new InterceptorChain();
    		chain.addInterceptor(new AshanInterceptor("1"));
    		chain.addInterceptor(new AshanInterceptor("2"));
    		chain.addInterceptor(new AshanInterceptor("3"));
    		//用InterceptorChain生成一个代理
    		AshanService proxy2=(AshanService)chain.pluginAll(service);
    		proxy2.service("chain");
    		
    		
    	}
    
    }
    

  
输出结果为

    AshanInterceptor[no_name]...before...
    Hello ashan
    AshanInterceptor[no_name]...after...
    ######################
    AshanInterceptor[3]...before...
    AshanInterceptor[2]...before...
    AshanInterceptor[1]...before...
    Hello chain
    AshanInterceptor[1]...after...
    AshanInterceptor[2]...after...
    AshanInterceptor[3]...after...

  

Mybatis中Plugin在实现方式
===================

先看拦截器接口

    public interface Interceptor {
      
      //jdk动态代码中的InvocationHandler.invoke()方法执行里，这个方法会被调用
      Object intercept(Invocation invocation) throws Throwable;
    
      //生成一个代理对象
      Object plugin(Object target);
    
      //设置属性
      void setProperties(Properties properties);
    
    }
    

  
再来看Plugin是怎么使用Interceptor接口的

  

    public class Plugin implements InvocationHandler {
      //Plugin实现了JDK动态代理中的InvocationHandler
    
      //被代理的原始对象
      private Object target;
      
    
      //拦截器
      private Interceptor interceptor;
    
      //这里定义了拦截器对原始对象的那些方法有效
      private Map<Class<?>, Set<Method>> signatureMap;
    
      private Plugin(Object target, Interceptor interceptor, Map<Class<?>, Set<Method>> signatureMap) {
        this.target = target;
        this.interceptor = interceptor;
        this.signatureMap = signatureMap;
      }
    
      
    
      public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
        try {
          Set<Method> methods = signatureMap.get(method.getDeclaringClass());
          if (methods != null && methods.contains(method)) {
            //这里方法在signatureMap中，需要拦截。调用interceptor.intercept()方法,注意这个target已经是原始对象了
            return interceptor.intercept(new Invocation(target, method, args));
          }
          //不需要拦截，直接执行
          return method.invoke(target, args);
        } catch (Exception e) {
          throw ExceptionUtil.unwrapThrowable(e);
        }
      }
    
    }

  

AshanInterceptor中是用Plugin类的一个静态方法wap()来生成一个代理对象的

     public static Object wrap(Object target, Interceptor interceptor) {
        //对拦截器中取出方法签名,是通过注解来声明需要拦截的方法签名的
        Map<Class<?>, Set<Method>> signatureMap = getSignatureMap(interceptor);
        Class<?> type = target.getClass();
    
        //获取被代理/拦截的对象实现的所有接口
        Class<?>[] interfaces = getAllInterfaces(type, signatureMap);
        if (interfaces.length > 0) {
          //这里最终还是用了JDK的动态代理，如果被代理/拦截的对象没有实现任何接口，JDK将无法代理。
          return Proxy.newProxyInstance(
              type.getClassLoader(),
              interfaces,
              new Plugin(target, interceptor, signatureMap));
        }
        return target;
      }

      
      //从注解中读取方法签名
      private static Map<Class<?>, Set<Method>> getSignatureMap(Interceptor interceptor) {
        Intercepts interceptsAnnotation = interceptor.getClass().getAnnotation(Intercepts.class);
        if (interceptsAnnotation == null) { // issue #251
          throw new PluginException("No @Intercepts annotation was found in interceptor " + interceptor.getClass().getName());      
        }
        Signature[] sigs = interceptsAnnotation.value();
        Map<Class<?>, Set<Method>> signatureMap = new HashMap<Class<?>, Set<Method>>();
        for (Signature sig : sigs) {
          Set<Method> methods = signatureMap.get(sig.type());
          if (methods == null) {
            methods = new HashSet<Method>();
            signatureMap.put(sig.type(), methods);
          }
          try {
            Method method = sig.type().getMethod(sig.method(), sig.args());
            methods.add(method);
          } catch (NoSuchMethodException e) {
            throw new PluginException("Could not find method on " + sig.type() + " named " + sig.method() + ". Cause: " + e, e);
          }
        }
        return signatureMap;
      }

  

InterceptorChain
================

在Configuration中的个InterceptorChain该对象保存了所有配置的拦截器

    public class InterceptorChain {
    
    
      //在mybatis-config.xml配置的拦截器
      private final List<Interceptor> interceptors = new ArrayList<Interceptor>();
    
    
      //用所有的拦截器生成对象
      public Object pluginAll(Object target) {
        for (Interceptor interceptor : interceptors) {
          //调用了interceptor.plugin()方法来生成代理对象
          target = interceptor.plugin(target);
        }
        return target;
      }
    
      public void addInterceptor(Interceptor interceptor) {
        interceptors.add(interceptor);
      }
      
      public List<Interceptor> getInterceptors() {
        return Collections.unmodifiableList(interceptors);
      }
    
    }

  
在来看pluginAll被哪些方法调用 

![](https://img-blog.csdn.net/20151224235252285)  

上图就充分验证发官方的如下描述

  

![](https://img-blog.csdn.net/20151224235448878)

小结
==

Mybatis是用jdk的动态代理来实现拦截器的，如果你了解jdk的动态代理，拦截器相关的源代码并不复杂，很容易就能看明白。

> 作者：ashan_li
> 链接：http://suo.im/5G73Rn
