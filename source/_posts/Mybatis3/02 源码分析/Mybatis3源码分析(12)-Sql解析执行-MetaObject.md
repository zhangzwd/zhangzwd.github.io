---
title: Mybatis3源码分析之MetaObject解析
tags:
  - MyBatis3源码解析
copyright: false
categories:
  - MyBatis3源码解析
translate_title: metaobject-analysis-of-mybatis3-source-code-analysis
special: m3s
original: false
reproduced: true
date: 2021-05-11 14:10:47
show_title: mybatis3-metaobject
---

MetaObject
==========

MetaObject类相当于一个工具类，Mybatis在sql参数设置和结果集映射里经常使用到这个对象。下面来详细分析一下这类。

这个类有四个属性，其中两个基本不用看。

      //原始的对象
      private Object originalObject;
      //对原始对象的一个包装
      private ObjectWrapper objectWrapper;
      
      //这两个属性基本不用，因为在Mybatis中都找不到ObjectWrapperFactory的有效实现类
      private ObjectFactory objectFactory;
      private ObjectWrapperFactory objectWrapperFactory;

  

再看他的方法

      
       //构造方法
       private MetaObject(Object object, ObjectFactory objectFactory, ObjectWrapperFactory objectWrapperFactory) {
        this.originalObject = object;
        this.objectFactory = objectFactory;
        this.objectWrapperFactory = objectWrapperFactory;
    
        if (object instanceof ObjectWrapper) {
          this.objectWrapper = (ObjectWrapper) object;
        } else if (objectWrapperFactory.hasWrapperFor(object)) {
          this.objectWrapper = objectWrapperFactory.getWrapperFor(this, object);
        } else if (object instanceof Map) {
          this.objectWrapper = new MapWrapper(this, (Map) object);
        } else if (object instanceof Collection) {
          this.objectWrapper = new CollectionWrapper(this, (Collection) object);
        } else {
          this.objectWrapper = new BeanWrapper(this, object);
        }
      }
    
      public String findProperty(String propName, boolean useCamelCaseMapping) {
        return objectWrapper.findProperty(propName, useCamelCaseMapping);
      }
    
      public String[] getGetterNames() {
        return objectWrapper.getGetterNames();
      }
    
      public String[] getSetterNames() {
        return objectWrapper.getSetterNames();
      }
    
      public Class<?> getSetterType(String name) {
        return objectWrapper.getSetterType(name);
      }
    
      public Class<?> getGetterType(String name) {
        return objectWrapper.getGetterType(name);
      }
    
      public boolean hasSetter(String name) {
        return objectWrapper.hasSetter(name);
      }
    
      public boolean hasGetter(String name) {
        return objectWrapper.hasGetter(name);
      }
      
      //从originalObject获取属性值
      public Object getValue(String name) {
        PropertyTokenizer prop = new PropertyTokenizer(name);
        if (prop.hasNext()) {
          MetaObject metaValue = metaObjectForProperty(prop.getIndexedName());
          if (metaValue == SystemMetaObject.NULL_META_OBJECT) {
            return null;
          } else {
            return metaValue.getValue(prop.getChildren());
          }
        } else {
          return objectWrapper.get(prop);
        }
      }
      
      //设置originalObject属性值
      public void setValue(String name, Object value) {
        PropertyTokenizer prop = new PropertyTokenizer(name);
        if (prop.hasNext()) {
          MetaObject metaValue = metaObjectForProperty(prop.getIndexedName());
          if (metaValue == SystemMetaObject.NULL_META_OBJECT) {
            if (value == null && prop.getChildren() != null) {
              return; // don't instantiate child path if value is null
            } else {
              metaValue = objectWrapper.instantiatePropertyValue(name, prop, objectFactory);
            }
          }
          metaValue.setValue(prop.getChildren(), value);
        } else {
          objectWrapper.set(prop, value);
        }
      }
     
     //应该是对collection的操作
     public void add(Object element) {
        objectWrapper.add(element);
      }
    
      //应该是对collection的操作
      public <e> void addAll(List<e> list) {
        objectWrapper.addAll(list);
      }
    
    

从上面代码中可以看出MetaObject主要是封装了originalObject对象，提供了get和set的方法用于获取和设置originalObject的属性值。其中originalObject最主要的有三种类型:

1.  Map类型
2.  Collection类型
3.  普通的java对象，有get和set方法的对象

getValue和setValue中的name参数支持复杂的属性访问：例如user.cust.custId,user.acts\[0\].acctId！

     
       public Object getValue(String name) {
        PropertyTokenizer prop = new PropertyTokenizer(name);
        if (prop.hasNext()) {
          MetaObject metaValue = metaObjectForProperty(prop.getIndexedName());
          if (metaValue == SystemMetaObject.NULL_META_OBJECT) {
            return null;
          } else {
            //这里相当于递归调用，直到最后一层。例如user.cust.custId
            //第一次递归cust.custId
            //第二次递归custId，这个就是真正访问要返回的
            return metaValue.getValue(prop.getChildren());
          }
        } else {
          return objectWrapper.get(prop);
        }
      }

  

getValue,setValue,add,addAll方法都是委托objectWrapper对象实现的。下面详细分析objectWrapper对象。

MapWrapper
==========

       public Object get(PropertyTokenizer prop) {
        if (prop.getIndex() != null) {//accts[0]这种方式
          Object collection = resolveCollection(prop, map);
          return getCollectionValue(prop, collection);
        } else {//userId这种方式
          return map.get(prop.getName());
        }
      }

    public void set(PropertyTokenizer prop, Object value) {
        if (prop.getIndex() != null) {<span style="font-family: Arial, Helvetica, sans-serif; font-size: 12px;">//accts[0]这种方式</span>
          Object collection = resolveCollection(prop, map);
          setCollectionValue(prop, collection, value);
        } else {//userId这种方式
          map.put(prop.getName(), value);
        }
      }

集合类的不支持

    public void add(Object element) {
        throw new UnsupportedOperationException();
      }
    
      public <E> void addAll(List<E> element) {
        throw new UnsupportedOperationException();
      }

  

CollectionWrapper
=================

最支持如下两个方法，其他不支持

  

    public void add(Object element) {
        object.add(element);
      }
    
      public <E> void addAll(List<E> element) {
        object.addAll(element);
      }

  

BeanWrapper
===========

    public Object get(PropertyTokenizer prop) {
        if (prop.getIndex() != null) {//accts[0]方式
          Object collection = resolveCollection(prop, object);
          return getCollectionValue(prop, collection);
        } else {//userId方式,反射
          return getBeanProperty(prop, object);
        }
      }

     public void set(PropertyTokenizer prop, Object value) {
        if (prop.getIndex() != null) {//accts[0]方式
          Object collection = resolveCollection(prop, object);
          setCollectionValue(prop, collection, value);
        } else {//userId方法，反射
          setBeanProperty(prop, object, value);
        }
      }

  
集合类的不支持  

      public void add(Object element) {
        throw new UnsupportedOperationException();
      }
    
      public <E> void addAll(List<E> list) {
        throw new UnsupportedOperationException();
      }

小结
==

MetaObject是一个工具类，提供了类似ognl和jstl这样的方式去访问map,collection及javabean。

这里举三个例子来总结MetaObject最主要的功能

对Map操作
------

    <span style="white-space:pre">		</span>Map<String,Object> map=new HashMap<>();
    		MetaObject metaObject=MetaObject.forObject(map, objectFactory, objectWrapperFactory);
    		
    		metaObject.setValue("UESR_ID", "123412");
    		//相当于执行了map.put("USER_ID","123412");
    		
    		Object obj=metaObject.getValue("UESR_ID");
    		//相当于执行了map.get("UESR_ID");

  

对JavaBean操作
===========

    <span style="white-space:pre">		</span>User user=new User();
    		MetaObject metaObject=MetaObject.forObject(user, objectFactory, objectWrapperFactory);
    		
    		metaObject.setValue("userId", "123412");
    		//相当于执行了user.setUserId("123412");
    		
    		Object obj=metaObject.getValue("userId");
    		//相当于执行了user.getUserId

  

对Collection操作
-------------

    <span style="white-space:pre">	</span>List<Object> list=new ArrayList<>();
    		MetaObject metaObject=MetaObject.forObject(list, objectFactory, objectWrapperFactory);
    		
    		metaObject.add("ashan");
    		//相当于执行了list.add("ashan");
    	
    		metaObject.getValue("[0]");
    		//相当于执行了list.get(0);

> 作者：ashan_li
> 链接：http://suo.im/5G73Rn
