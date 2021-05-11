---
title: Mybatis3源码分析之Mapper实现
tags:
  - MyBatis3源码解析
copyright: false
categories:
  - MyBatis3源码解析
translate_title: mapper-implementation-of-mybatis3-source-code-analysis
special: m3s
original: false
reproduced: true
date: 2021-05-11 16:00:47
show_title: mybatis3-mapper-implementation
---

整体加载过程
======

1.  mybatis-config.xml中可以在包(package)和class的方法让Mybatis加载一个Mapper
2.  通过包的方式是从包加载所有的class,最条还是通过class方法来实现加载
3.  加载过程中主要通过读取方法中的注解来生成MappedStatement对象，再加入到Configuration中。这个过程跟解析mapper.xml配置文件中的select/insert/update/delete节点的过程差不多。一个是从xml里读取信息，一个是从注解里读取信息。
4.  通过注解生成的MappedStatement的Id生成规则为接口全限定名名加方法的名字，所以在定义Mapper接口类时千万不要重载方法，否则会发生预想不到的问题。
5.  Mapper接口中的只有包含如下八种注解中的一种才会被Mybatis解析成一个MappedStatement对象。
    1.  Select/Insert/Update/Delete
    2.  SelectProvider/InsertProvider/UpdateProvider/DeleteProvider一个方法如果没有这些注解中的其中一个，执行时Mybatis会报MappedStatement找不到
6.  Mybatis加载一个Mapper接口时会为其生成一个MapperProxyFactory对象，由这个对象来创建Mapper接口的实例。MapperProxyFactory这个类的实现在下一节详细分析。

Mapper的配置加载是从XmlConfigBuilder.mapperElement()方法中触发的

    private void mapperElement(XNode parent) throws Exception {
        if (parent != null) {
          for (XNode child : parent.getChildren()) {
            
            if ("package".equals(child.getName())) {
              //通过package的方法
              String mapperPackage = child.getStringAttribute("name");
              configuration.addMappers(mapperPackage);
            } else {
              String resource = child.getStringAttribute("resource");
              String url = child.getStringAttribute("url");
              String mapperClass = child.getStringAttribute("class");
              if (resource != null && url == null && mapperClass == null) {
                ErrorContext.instance().resource(resource);
                InputStream inputStream = Resources.getResourceAsStream(resource);
                XMLMapperBuilder mapperParser = new XMLMapperBuilder(inputStream, configuration, resource, configuration.getSqlFragments());
                mapperParser.parse();
              } else if (resource == null && url != null && mapperClass == null) {
                ErrorContext.instance().resource(url);
                InputStream inputStream = Resources.getUrlAsStream(url);
                XMLMapperBuilder mapperParser = new XMLMapperBuilder(inputStream, configuration, url, configuration.getSqlFragments());
                mapperParser.parse();
              } else if (resource == null && url == null && mapperClass != null) {
                Class<?> mapperInterface = Resources.classForName(mapperClass);
                //指定class的方式
                configuration.addMapper(mapperInterface);
              } else {
                throw new BuilderException("A mapper element may only specify a url, resource or class, but not more than one.");
              }
            }
          }
        }
      }

通过package方式加载，最终也是找出所有符合条件的mapper类，再通过class的方法加载。

先来看configuration.addMaper()方法

     public <T> void addMapper(Class<T> type) {
        //最终是由MapperRegistry对象来完成加载的
        mapperRegistry.addMapper(type);
      }

     public <T> void addMapper(Class<T> type) {
        if (type.isInterface()) {
          if (hasMapper(type)) {
            throw new BindingException("Type " + type + " is already known to the MapperRegistry.");
          }
          boolean loadCompleted = false;
          try {
            //这里为一个Mapper生成一个代理工厂，这个代理工厂通过JDK动态代理生成一个对象，稍后再详细分析。
            knownMappers.put(type, new MapperProxyFactory<T>(type));
            // It's important that the type is added before the parser is run
            // otherwise the binding may automatically be attempted by the
            // mapper parser. If the type is already known, it won't try.
            MapperAnnotationBuilder parser = new MapperAnnotationBuilder(config, type);
            //Mapper.xml是交由XMLMapperBuilder来解析的
            //同样这里使用了MapperAnnotationBuilder来解析注解
            parser.parse();
            loadCompleted = true;
          } finally {
            if (!loadCompleted) {
              knownMappers.remove(type);
            }
          }
        }

MapperAnnotationBuilder.parse()方法
=================================

    public void parse() {
        String resource = type.toString();
        if (!configuration.isResourceLoaded(resource)) {
          //这里会先去加载相对应的mapper.xml配置文件
          //也就是说解析UserDao注解时，如果发现有UserDao.xml配置文件会先加载UesrDao.xml配置文件
          loadXmlResource();
          configuration.addLoadedResource(resource);
          assistant.setCurrentNamespace(type.getName());
          parseCache();
          parseCacheRef();
          //获取class中所有的方法
          Method[] methods = type.getMethods();
          for (Method method : methods) {
            try {
              //解析方法
              parseStatement(method);
            } catch (IncompleteElementException e) {
              configuration.addIncompleteMethod(new MethodResolver(this, method));
            }
          }
        }
        parsePendingMethods();
      }

  

      //这个方法的功能就是读取方法的注解，生成一个MappedStatement对象，然后加入到Configuration中
      void parseStatement(Method method) {
        Class<?> parameterTypeClass = getParameterType(method);
        LanguageDriver languageDriver = getLanguageDriver(method);
        //从注解中获取一个SqlSource,之前已经分析过MappedStatement对应一个SqlSource对象，表示配置的Sql
        SqlSource sqlSource = getSqlSourceFromAnnotations(method, parameterTypeClass, languageDriver);
        //如果sqlSource为空，这个方法将直接返回
        if (sqlSource != null) {
          //读取方法中的Options注解
          Options options = method.getAnnotation(Options.class);
          //注意这个mappedStatementId的生成规则，Mybatis生成的Mapper代理对象也是根据这个规则来生成一个mappedStatementId，再去Configuration中加载MappedStatement的
          final String mappedStatementId = type.getName() + "." + method.getName();
          Integer fetchSize = null;
          Integer timeout = null;
          StatementType statementType = StatementType.PREPARED;
          ResultSetType resultSetType = ResultSetType.FORWARD_ONLY;
          SqlCommandType sqlCommandType = getSqlCommandType(method);
          boolean isSelect = sqlCommandType == SqlCommandType.SELECT;
    
          //注意这个
          //这两个是设置二级缓存的，如果没有设置options注解，将使用如下默认值
          //如果是update/insert/delete语句，就行里就会刷新缓存,select语句则不刷新
          //如果是select语句是默认使用缓存的
          boolean flushCache = !isSelect;
          boolean useCache = isSelect;
    
          KeyGenerator keyGenerator;
          String keyProperty = "id";
          String keyColumn = null;
    
          //自动生成主键，一般在应用中比较少用
          if (SqlCommandType.INSERT.equals(sqlCommandType) || SqlCommandType.UPDATE.equals(sqlCommandType)) {
            // first check for SelectKey annotation - that overrides everything else
            SelectKey selectKey = method.getAnnotation(SelectKey.class);
            if (selectKey != null) {
              keyGenerator = handleSelectKeyAnnotation(selectKey, mappedStatementId, getParameterType(method), languageDriver);
              keyProperty = selectKey.keyProperty();
            } else {
              if (options == null) {
                keyGenerator = configuration.isUseGeneratedKeys() ? new Jdbc3KeyGenerator() : new NoKeyGenerator();
              } else {
                keyGenerator = options.useGeneratedKeys() ? new Jdbc3KeyGenerator() : new NoKeyGenerator();
                keyProperty = options.keyProperty();
                keyColumn = options.keyColumn();
              }
            }
          } else {
            keyGenerator = new NoKeyGenerator();
          }
    
          if (options != null) {
            flushCache = options.flushCache();
            useCache = options.useCache();
            fetchSize = options.fetchSize() > -1 || options.fetchSize() == Integer.MIN_VALUE ? options.fetchSize() : null; //issue #348
            timeout = options.timeout() > -1 ? options.timeout() : null;
            statementType = options.statementType();
            resultSetType = options.resultSetType();
          }
         
          //获取对应的resultMap,还可以配置多个，用","分隔
          String resultMapId = null;
          ResultMap resultMapAnnotation = method.getAnnotation(ResultMap.class);
          if (resultMapAnnotation != null) {
            String[] resultMaps = resultMapAnnotation.value();
            StringBuilder sb = new StringBuilder();
            for (String resultMap : resultMaps) {
              if (sb.length() > 0) sb.append(",");
              sb.append(resultMap);
            }
            resultMapId = sb.toString();
          } else if (isSelect) {
            //如果没有配置resultMap，自动生成一个加入到Configuration中，就像Mapper.xml配置文件中只配置了resultType属性那样
            resultMapId = parseResultMap(method);
          }
          
          //这里跟加载mapper.xml配置文件中一样，交由助手去生成一个MappedStatement并加入到Configuration中
          assistant.addMappedStatement(
              mappedStatementId,
              sqlSource,
              statementType,
              sqlCommandType,
              fetchSize,
              timeout,
              null,                             // ParameterMapID
              parameterTypeClass,
              resultMapId,    // ResultMapID
              getReturnType(method),
              resultSetType,
              flushCache,
              useCache,
              false, // TODO issue #577
              keyGenerator,
              keyProperty,
              keyColumn,
              null,
              languageDriver,
              null);
        }
      }

  

再来看是怎么生成SqlSource对象的

     private SqlSource getSqlSourceFromAnnotations(Method method, Class<?> parameterType, LanguageDriver languageDriver) {
        try {
          //获取方法的注解，Select/Update/Insert/Delete中的一种
          Class<? extends Annotation> sqlAnnotationType = getSqlAnnotationType(method);
          //获取方法的注解，SelectProvider/UpdateProvider/InsertProvider/DeleteProvider中的一种
          Class<? extends Annotation> sqlProviderAnnotationType = getSqlProviderAnnotationType(method);
    
          if (sqlAnnotationType != null) {
            if (sqlProviderAnnotationType != null) {
              //不支持两种注解同时存在
              throw new BindingException("You cannot supply both a static SQL and SqlProvider to method named " + method.getName());
            }
            
            Annotation sqlAnnotation = method.getAnnotation(sqlAnnotationType);
            //直接读取Select/Update/Insert/Delete中的sql内容
            final String[] strings = (String[]) sqlAnnotation.getClass().getMethod("value").invoke(sqlAnnotation);
            //通过sql创建一个SqlSource,这里的逻辑眼从mapper.xml文件读取里的逻辑差不多，不再讨论
            return buildSqlSourceFromStrings(strings, parameterType, languageDriver);
          } else if (sqlProviderAnnotationType != null) {
            Annotation sqlProviderAnnotation = method.getAnnotation(sqlProviderAnnotationType);
            //这个SqlSource主要是通过反射执行SelectProvider/UpdateProvider/InsertProvider/DeleteProvider的方法得到sql内容,也不再讨论
            return new ProviderSqlSource(assistant.getConfiguration(), sqlProviderAnnotation);
          }
          return null;
        } catch (Exception e) {
          throw new BuilderException("Could not find value method on SQL annotation.  Cause: " + e, e);
        }
      }

> 作者：ashan_li
> 链接：http://suo.im/5G73Rn
