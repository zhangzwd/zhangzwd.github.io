---
title: Mybatis3源码分析之ResultSetHandler
tags:
  - MyBatis3源码解析
copyright: false
categories:
  - MyBatis3源码解析
translate_title: mybatis3-source-code-analysis-of-resultsethandler
special: m3s
original: false
reproduced: true
date: 2021-05-11 13:30:47
show_title: mybatis3-resultsethandler
---

在PreparedStatementHandler中的query()方法中，是用ResultSetHandler来完成结果集的映射的。

     public <E> List<E> query(Statement statement, ResultHandler resultHandler) throws SQLException {
        PreparedStatement ps = (PreparedStatement) statement;
        ps.execute();
        return resultSetHandler.<E> handleResultSets(ps);
      }

Mybatis中只提供了一个ResultSetHandler的实现，那就是DefaultResultSetHandler。下面来看看他的handleResultSets()方法

    public List<Object> handleResultSets(Statement stmt) throws SQLException {
        final List<Object> multipleResults = new ArrayList<Object>();
    
        int resultSetCount = 0;
        //获取第一个ResultSet,通常只会有一个
        ResultSetWrapper rsw = getFirstResultSet(stmt);
        //从配置中读取对应的ResultMap，通常也只会有一个
        List<ResultMap> resultMaps = mappedStatement.getResultMaps();
        int resultMapCount = resultMaps.size();
        validateResultMapsCount(rsw, resultMapCount);
        while (rsw != null && resultMapCount > resultSetCount) {
          ResultMap resultMap = resultMaps.get(resultSetCount);
          //完成映射，将结果加到入multipleResults中
          handleResultSet(rsw, resultMap, multipleResults, null);
          rsw = getNextResultSet(stmt);
          cleanUpAfterHandlingResultSet();
          resultSetCount++;
        }
    
        String[] resultSets = mappedStatement.getResulSets();
        if (resultSets != null) {
          while (rsw != null && resultSetCount < resultSets.length) {
            ResultMapping parentMapping = nextResultMaps.get(resultSets[resultSetCount]);
            if (parentMapping != null) {
              String nestedResultMapId = parentMapping.getNestedResultMapId();
              ResultMap resultMap = configuration.getResultMap(nestedResultMapId);
              handleResultSet(rsw, resultMap, null, parentMapping);
            }
            rsw = getNextResultSet(stmt);
            cleanUpAfterHandlingResultSet();
            resultSetCount++;
          }
        }
        //如果只有一个映射，返回第一个
        return collapseSingleResultList(multipleResults);
      }

  

在实际运行过程中，通常情况下一个Sql语句只返回一个结果集，对多个结果集的情况不做分析 。实际很少用到。

继续看handleResultSet方法

    private void handleResultSet(ResultSetWrapper rsw, ResultMap resultMap, List<Object> multipleResults, ResultMapping parentMapping) throws SQLException {
        try {
          if (parentMapping != null) {
            //子映射
            handleRowValues(rsw, resultMap, null, RowBounds.DEFAULT, parentMapping);
          } else {
            //一般情况resultHandler都为空,见ResultHandler.NO_RESULT_HANDLER
            if (resultHandler == null) {
              DefaultResultHandler defaultResultHandler = new DefaultResultHandler(objectFactory);
              //生成对象，并加到defaultResultHandler.resultList集合中
              handleRowValues(rsw, resultMap, defaultResultHandler, rowBounds, null);
              //将结果加入multipleResults中
              multipleResults.add(defaultResultHandler.getResultList());
            } else {
              handleRowValues(rsw, resultMap, resultHandler, rowBounds, null);
            }
          }
        } finally {
          //关闭结果集
          closeResultSet(rsw.getResultSet()); // issue #228 (close resultsets)
        }
      }

  

    private void handleRowValues(ResultSetWrapper rsw, ResultMap resultMap, ResultHandler resultHandler, RowBounds rowBounds, ResultMapping parentMapping) throws SQLException {
        if (resultMap.hasNestedResultMaps()) {
          //有子映射或内映射的情况
          ensureNoRowBounds();
          checkResultHandler();
          handleRowValuesForNestedResultMap(rsw, resultMap, resultHandler, rowBounds, parentMapping);
        } else {
          //没有子映射或内映射
          handleRowValuesForSimpleResultMap(rsw, resultMap, resultHandler, rowBounds, parentMapping);
        }
      }  

简单映射handleRowValuesForSimpleResultMap  

========================================

    private void handleRowValuesForSimpleResultMap(ResultSetWrapper rsw, ResultMap resultMap, ResultHandler resultHandler, RowBounds rowBounds, ResultMapping parentMapping)
          throws SQLException {
        DefaultResultContext resultContext = new DefaultResultContext();
        skipRows(rsw.getResultSet(), rowBounds);
        while (shouldProcessMoreRows(rsw.getResultSet(), resultContext, rowBounds)) {
          //discriminator的处理,可以根据条件选择不同的映射
          ResultMap discriminatedResultMap = resolveDiscriminatedResultMap(rsw.getResultSet(), resultMap, null);
          //真正从ResultSet中映射出一个对象
          Object rowValue = getRowValue(rsw, discriminatedResultMap);
          //加入resultHandler.resultList中
          storeObject(resultHandler, resultContext, rowValue, parentMapping, rsw.getResultSet());
        }
      }

       //没有内映射
       private Object getRowValue(ResultSetWrapper rsw, ResultMap resultMap) throws SQLException {
        final ResultLoaderMap lazyLoader = new ResultLoaderMap();
        //实例化一个对象,类型为resultMap.getType(),最终调用了ObjectFactory.create()方法
        Object resultObject = createResultObject(rsw, resultMap, lazyLoader, null);
        if (resultObject != null && !typeHandlerRegistry.hasTypeHandler(resultMap.getType())) {
          //设置对象属性
          final MetaObject metaObject = configuration.newMetaObject(resultObject);
          boolean foundValues = resultMap.getConstructorResultMappings().size() > 0;
          if (shouldApplyAutomaticMappings(resultMap, !AutoMappingBehavior.NONE.equals(configuration.getAutoMappingBehavior()))) { 
            //自动映射,结果集中有的column，但resultMap中并没有配置   
            foundValues = applyAutomaticMappings(rsw, resultMap, metaObject, null) || foundValues;
          }
          //映射result节点
          foundValues = applyPropertyMappings(rsw, resultMap, metaObject, lazyLoader, null) || foundValues;
          foundValues = lazyLoader.size() > 0 || foundValues;
          resultObject = foundValues ? resultObject : null;
          return resultObject;
        }
        return resultObject;
      }

以上代码开始总结出简单映射(没有内映射)的逻辑

1.  每条结果都会生成一个java对象
2.  根据构造方法实例化对象
3.  自动映射(结果集有但在resultMap里没有配置的字段)，有两情况会发生自动映射
    1.  在resultMap上配置了autoMapping="true"属性
    2.  在mybatis-config.xml配置了autoMappingBehavior="PARTIAL|FULL"，默认为PARTIAL。  
        在实际应用中，都会使用自动映射，减少配置的工作。自动映射在Mybatis中也是默认开启的。
4.  最后再映射属性。

根据构造方法实例化对象
-----------

    <pre name="code" class="java">private Object createResultObject(ResultSetWrapper rsw, ResultMap resultMap, ResultLoaderMap lazyLoader, String columnPrefix) throws SQLException {
        //构造方法中的参数类型
        final List<Class<?>> constructorArgTypes = new ArrayList<Class<?>>();
        //构造方法中具体值
        final List<Object> constructorArgs = new ArrayList<Object>();
        //根据构造方法生成对象
        final Object resultObject = createResultObject(rsw, resultMap, constructorArgTypes, constructorArgs, columnPrefix);
        if (resultObject != null && !typeHandlerRegistry.hasTypeHandler(resultMap.getType())) {
          final List<ResultMapping> propertyMappings = resultMap.getPropertyResultMappings();
          for (ResultMapping propertyMapping : propertyMappings) {
            if (propertyMapping.getNestedQueryId() != null && propertyMapping.isLazy()) { // issue gcode #109 && issue #149
              return configuration.getProxyFactory().createProxy(resultObject, lazyLoader, configuration, objectFactory, constructorArgTypes, constructorArgs);
            }
          }
        }
        return resultObject;
      }
    
      private Object createResultObject(ResultSetWrapper rsw, ResultMap resultMap, List<Class<?>> constructorArgTypes, List<Object> constructorArgs, String columnPrefix)
          throws SQLException {
        final Class<?> resultType = resultMap.getType();
        //resultMap配置中的construnctor节点
        final List<ResultMapping> constructorMappings = resultMap.getConstructorResultMappings();
        if (typeHandlerRegistry.hasTypeHandler(resultType)) {
          return createPrimitiveResultObject(rsw, resultMap, columnPrefix);
        } else if (constructorMappings.size() > 0) {
          //construnctor节点有配置
          return createParameterizedResultObject(rsw, resultType, constructorMappings, constructorArgTypes, constructorArgs, columnPrefix);
        } else {
         //construnctor节点没有配置，调用无参的构造方法
          return objectFactory.create(resultType);
        }
      }
    
      private Object createParameterizedResultObject(ResultSetWrapper rsw, Class<?> resultType, List<ResultMapping> constructorMappings, List<Class<?>> constructorArgTypes,
          List<Object> constructorArgs, String columnPrefix) throws SQLException {
        boolean foundValues = false;
        for (ResultMapping constructorMapping : constructorMappings) {
          final Class<?> parameterType = constructorMapping.getJavaType();
          final String column = constructorMapping.getColumn();
          final Object value; 
         //取出参数类型和具体的值
          if (constructorMapping.getNestedQueryId() != null) {
            value = getNestedQueryConstructorValue(rsw.getResultSet(), constructorMapping, columnPrefix);
          } else if (constructorMapping.getNestedResultMapId() != null) {
            final ResultMap resultMap = configuration.getResultMap(constructorMapping.getNestedResultMapId());
            value = getRowValue(rsw, resultMap);
          } else {
            final TypeHandler<?> typeHandler = constructorMapping.getTypeHandler();
            value = typeHandler.getResult(rsw.getResultSet(), prependPrefix(column, columnPrefix));
          }
          constructorArgTypes.add(parameterType);
          constructorArgs.add(value);
          foundValues = value != null || foundValues;
        }
         //创建对象
        return foundValues ? objectFactory.create(resultType, constructorArgTypes, constructorArgs) : null;
      }

自动映射
----

      private boolean applyAutomaticMappings(ResultSetWrapper rsw, ResultMap resultMap, MetaObject metaObject, String columnPrefix) throws SQLException {
        //获取结果集中在resultMap中没有配置的列名
        //如果resultMap中只设置了resultType="java.util.HashMap"的话，全都会在这里完成映射
        final List<String> unmappedColumnNames = rsw.getUnmappedColumnNames(resultMap, columnPrefix);
        boolean foundValues = false;
        for (String columnName : unmappedColumnNames) {
          //属性名就是列名
          String propertyName = columnName;
          if (columnPrefix != null && columnPrefix.length() > 0) {
            // When columnPrefix is specified,
            // ignore columns without the prefix.
            if (columnName.toUpperCase(Locale.ENGLISH).startsWith(columnPrefix)) {
              propertyName = columnName.substring(columnPrefix.length());
            } else {
              continue;
            }
          }
          //是否有对应的属性
          final String property = metaObject.findProperty(propertyName, configuration.isMapUnderscoreToCamelCase());
          //是否有对应的set方法
          if (property != null && metaObject.hasSetter(property)) {
            final Class<?> propertyType = metaObject.getSetterType(property);
            if (typeHandlerRegistry.hasTypeHandler(propertyType)) {
              final TypeHandler<?> typeHandler = rsw.getTypeHandler(propertyType, columnName);
              final Object value = typeHandler.getResult(rsw.getResultSet(), columnName);
              if (value != null || configuration.isCallSettersOnNulls()) { // issue #377, call setter on nulls
                if (value != null || !propertyType.isPrimitive()) {
                  //直接设置
                  metaObject.setValue(property, value);
                }
                foundValues = true;
              }
            }
          }
        }
        return foundValues;
      }

映射result节点
----------

     private boolean applyPropertyMappings(ResultSetWrapper rsw, ResultMap resultMap, MetaObject metaObject, ResultLoaderMap lazyLoader, String columnPrefix)
          throws SQLException {
        final List<String> mappedColumnNames = rsw.getMappedColumnNames(resultMap, columnPrefix);
        boolean foundValues = false;
        //获取需要映射的ResultMapping
        final List<ResultMapping> propertyMappings = resultMap.getPropertyResultMappings();
        for (ResultMapping propertyMapping : propertyMappings) {
          final String column = prependPrefix(propertyMapping.getColumn(), columnPrefix);
          if (propertyMapping.isCompositeResult() 
              || (column != null && mappedColumnNames.contains(column.toUpperCase(Locale.ENGLISH))) 
              || propertyMapping.getResultSet() != null) {
            //在结果中的获取对应的值
            Object value = getPropertyMappingValue(rsw.getResultSet(), metaObject, propertyMapping, lazyLoader, columnPrefix);
            final String property = propertyMapping.getProperty(); // issue #541 make property optional
            if (value != NO_VALUE && property != null && (value != null || configuration.isCallSettersOnNulls())) { // issue #377, call setter on nulls
              if (value != null || !metaObject.getSetterType(property).isPrimitive()) {
                //设置属性
                metaObject.setValue(property, value);
              }
              foundValues = true;
            }
          }
        }
        return foundValues;
      }

  

     private Object getPropertyMappingValue(ResultSet rs, MetaObject metaResultObject, ResultMapping propertyMapping, ResultLoaderMap lazyLoader, String columnPrefix)
          throws SQLException {
        if (propertyMapping.getNestedQueryId() != null) {
          //子查询，这里就是会产生N+1次查询的地方，每个记录都会再执行一个子查询。子查询的过程这里就不在讨论了。
          return getNestedQueryMappingValue(rs, metaResultObject, propertyMapping, lazyLoader, columnPrefix);
        } else if (propertyMapping.getResultSet() != null) {
          addPendingChildRelation(rs, metaResultObject, propertyMapping);
          return NO_VALUE;
        } else if (propertyMapping.getNestedResultMapId() != null) {
          // the user added a column attribute to a nested result map, ignore it
          return NO_VALUE;
        } else {
          final TypeHandler<?> typeHandler = propertyMapping.getTypeHandler();
          final String column = prependPrefix(propertyMapping.getColumn(), columnPrefix);
          //直接从结果集里获取。
          return typeHandler.getResult(rs, column);
        }
      }

复杂映射(内映射)handleRowValuesForNestedResultMap
==========================================

处理这种映射的逻辑比较复杂。这里先举例说明:

配置如下resultMap

    <resultMap type="com.ashan.mybatis.User" id="detailUserResultMap"><!-- 整个resultMap会被解析成一个ResultMap对应 -->
    		<constructor>
    			<idArg column="user_id" javaType="String"/><!-- idArg会被解析成一个resultMapping对象 -->
    			<arg column="user_name" javaType="String"/><!-- resultMapping对象 -->
    		</constructor>
    	
    		<result property="svcnum" column="svc_num" /> <!-- resultMapping对象 -->
    		
    		<association property="cust" javaType="com.ashan.mybatis.Cust"> <!-- resultMapping对象 这个resultMapping对象指向了另一个ResultMap-->
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

假设需要映射的结果集:

![](https://img-blog.csdn.net/20151223232813379)  
可以看出，这个结果集将最终会映射成两个对象User对象，两个User对象对应的Cust对应都是cust\_01，id为user\_01对应的accts为：acct\_01,acct\_02,acct\_04;user\_02对应的acct只有一个acct\_03。

  

User对象映射过程
----------

下面来看Mybatis是怎么生成这两个User对象的。

  

    private void handleRowValuesForNestedResultMap(ResultSetWrapper rsw, ResultMap resultMap, ResultHandler resultHandler, RowBounds rowBounds, ResultMapping parentMapping) throws SQLException {
        final DefaultResultContext resultContext = new DefaultResultContext();
        skipRows(rsw.getResultSet(), rowBounds);
        Object rowValue = null;
        while (shouldProcessMoreRows(rsw.getResultSet(), resultContext, rowBounds)) {
          
          //开始处理一行新的结果集记录      
          final ResultMap discriminatedResultMap = resolveDiscriminatedResultMap(rsw.getResultSet(), resultMap, null);
    
          //为这行记录生成一个key,createRowKey方法会利用idResultMapping(即idArg,和id节点)和resultMap的id来生成key
          //例子中第1、2、4条记录生成的key都是一样的,大概内容为detailUserResultMap:user_01
          //第3条记录生成的key大概内容为detailUserResultMap:user_02
          final CacheKey rowKey = createRowKey(discriminatedResultMap, rsw, null);
          //nestedResultObjects是一个HashMap对象，在映射过程中所有生成的映射对象(包括内映射对象)，都会生成一个key并保存在这里。
          //例子中生成映射对象有三类：User,Cust,Acct
          
          Object partialObject = nestedResultObjects.get(rowKey);
          //如果是处理第1、3条记录，这里的parialObject为null值
          //如果是处理第2、4条记录，这里的parialObject不为null
          //
          if (mappedStatement.isResultOrdered()) { // issue #577 && #542
            //先不讨论
            if (partialObject == null && rowValue != null) {
              nestedResultObjects.clear();
              storeObject(resultHandler, resultContext, rowValue, parentMapping, rsw.getResultSet());
            }
            rowValue = getRowValue(rsw, discriminatedResultMap, rowKey, rowKey, null, partialObject);
          } else {
            //这个方法把结果集的记录映射成java对象
            //处理第一条记录时，rowValue是新生成的User对象(user_01)其中属性cust为cust_01,accts里只有一个acct_01
            //处理第二条记录时，rowValue对象就是第一条记录生成里的User对象，不过这时accts里多了一条acct_02
            //处理第三条记录时，rowValue为新生成的User对象(user_02)，cust属性为cust_01,accts只有一个acct_03
            //处理第四条记录时，rowValue对象就是第一条记录生成里的User对象，这时accts里又多了一条acct_04
            rowValue = getRowValue(rsw, discriminatedResultMap, rowKey, rowKey, null, partialObject);
            //只有第一条记录和第三条记录partialObject才会为null
            if (partialObject == null) {
              //把User对象加入到resultHandler.resultList中，这里也可以看出，虽然有四条记录，但只会被映射成两个User对象
              storeObject(resultHandler, resultContext, rowValue, parentMapping, rsw.getResultSet());
            }
          }
        }
        if (rowValue != null && mappedStatement.isResultOrdered()) {
          storeObject(resultHandler, resultContext, rowValue, parentMapping, rsw.getResultSet());
        }
      }

  

接下来继续看User对象的生成过程

     private Object getRowValue(ResultSetWrapper rsw, ResultMap resultMap, CacheKey combinedKey, CacheKey absoluteKey, String columnPrefix, Object partialObject) throws SQLException {
        final String resultMapId = resultMap.getId();
        Object resultObject = partialObject;
        //第一和第三条记录时，partialObject为null, resultObject也为null
        if (resultObject != null) {
          //处理第二、四条记录里会执行这里
          final MetaObject metaObject = configuration.newMetaObject(resultObject);
          putAncestor(absoluteKey, resultObject, resultMapId, columnPrefix);
          //直接调用内映射，即设置处理cust和accts，例子中主要是加入一个acct,因为cust只有一个，在user对象创建里就会被创建
          applyNestedResultMappings(rsw, resultMap, metaObject, columnPrefix, combinedKey, false);
          ancestorObjects.remove(absoluteKey);
        } else {
          //处理第一、三条记录里会执行这里,说明需要创建一个新的User对象
          final ResultLoaderMap lazyLoader = new ResultLoaderMap();
          //创建一个user对象，跟简单映射的处理方式一样
          resultObject = createResultObject(rsw, resultMap, lazyLoader, columnPrefix);
          if (resultObject != null && !typeHandlerRegistry.hasTypeHandler(resultMap.getType())) {
            final MetaObject metaObject = configuration.newMetaObject(resultObject);
            boolean foundValues = resultMap.getConstructorResultMappings().size() > 0;
            if (shouldApplyAutomaticMappings(resultMap, AutoMappingBehavior.FULL.equals(configuration.getAutoMappingBehavior()))) {
              //自动映射，跟简单映射的处理方式一样,跟简单映射的处理方式一样,例子中不会执行这一步
              foundValues = applyAutomaticMappings(rsw, resultMap, metaObject, columnPrefix) || foundValues;
            }   
            //映射reulst节点，跟简单映射的处理方式一样,跟简单映射的处理方式一样 ,例子中主要映射svc_num    
            foundValues = applyPropertyMappings(rsw, resultMap, metaObject, lazyLoader, columnPrefix) || foundValues;
            putAncestor(absoluteKey, resultObject, resultMapId, columnPrefix);
            //调用内映射，即生成cust和acct对象并设置到User对象中
            foundValues = applyNestedResultMappings(rsw, resultMap, metaObject, columnPrefix, combinedKey, true) || foundValues;
            ancestorObjects.remove(absoluteKey);
            foundValues = lazyLoader.size() > 0 || foundValues;
            resultObject = foundValues ? resultObject : null;
          }
          //注意这里，生成User对象里combinedKey就是User对象的key,将新创建的两个User对象加入nestedResultObjects中，以便后续处理使用，在处理第二、四条记录里就可以使用对应的User对象了。
          if (combinedKey != CacheKey.NULL_CACHE_KEY) nestedResultObjects.put(combinedKey, resultObject);
        }
        return resultObject;
      }
    

  
上面是User对象的生成过程。nestedResultObjects在处理过程的作用很重要，由这个容器来控制是否需要创建新的User对象。

  

Cust对象映射过程
----------

  

再来看Cust对象是怎么生成并加入到User对象中的

      //处理内映射，生成内映射对象，并加入到上层对象中。这里主要根据例子分析Cust对象的生成，上层对象为User
     private boolean applyNestedResultMappings(ResultSetWrapper rsw, ResultMap resultMap, MetaObject metaObject, String parentPrefix, CacheKey parentRowKey, boolean newObject) {
        boolean foundValues = false;
        for (ResultMapping resultMapping : resultMap.getPropertyResultMappings()) {
          final String nestedResultMapId = resultMapping.getNestedResultMapId();
          if (nestedResultMapId != null && resultMapping.getResultSet() == null) {
             //resultMap中的collection,association节点都会被生成一个nestedResultMap,这里分析Cust对象，也就是association
            try {
              final String columnPrefix = getColumnPrefix(parentPrefix, resultMapping);
              //获取内映射的ResultMap
              final ResultMap nestedResultMap = getNestedResultMap(rsw.getResultSet(), nestedResultMapId, columnPrefix);
              CacheKey rowKey = null;
              Object ancestorObject = null;
              if (ancestorColumnPrefix.containsKey(nestedResultMapId)) {
                //第二、三、四记录时会执行,ancestorColumnPrefi也是一个HashMap,保存的是什么内容下面再看
                //第一条记录时，肯定不会有这个对应关系
                rowKey = createRowKey(nestedResultMap, rsw, ancestorColumnPrefix.get(nestedResultMapId));
               
                //这个ancestorObjects是一个HashMap跟名字一样只会保存原始对应，也就是上层对象，这里cust和acct对象是最下层的对象了。也就是说cust和acct没有内映射了
                //所以例子中ancestorObjects只会保留User对象
                ancestorObject = ancestorObjects.get(rowKey);
              }
              if (ancestorObject != null) { 
                if (newObject) metaObject.setValue(resultMapping.getProperty(), ancestorObject);
              } else {
                //映射四条记录的Cust对应都会执行这里
                //这里是生成内映射Cust的key,大概是这样的:Cust:cust_01
                rowKey = createRowKey(nestedResultMap, rsw, columnPrefix);
    
                //这里的combineKeys是跟上层对象组合成的一个key
                //parentRowKey为上层对象(User对象)的key,第一、二、四条记录为user_01,第三条记录为user_02
                //这样combineKey值大概为:第一、二、四条记录为user_01:cust_01,第三条记录为user_02:cust_01
                final CacheKey combinedKey = combineKeys(rowKey, parentRowKey);   
                
                //从nestedResultObjects获取
                //第一、三条记录rowValue是为null的,第二、四条记录与第一条记录的combinedKey一样，所以rowValue的值不一样         
                Object rowValue = nestedResultObjects.get(combinedKey);
                boolean knownValue = (rowValue != null);
                //检查要映射的对象是否为Collection类型，这里是Cust类型，collectionProperty为null
                final Object collectionProperty = instantiateCollectionPropertyIfAppropriate(resultMapping, metaObject);            
                if (anyNotNullColumnHasValue(resultMapping, columnPrefix, rsw.getResultSet())) {
                  //生成Cust对象
                  //注意入参的rowValue，第一、三条记录为null
                  rowValue = getRowValue(rsw, nestedResultMap, combinedKey, rowKey, columnPrefix, rowValue);
                  if (rowValue != null && !knownValue) {
                    //第一、三条记录时才会执行这里，第二、四条记录用的是第一条中的Cust对象，不用重复设置                 
    
                    if (collectionProperty != null) {
                      //User.cust属性不是集合，不会执行这里
                      final MetaObject targetMetaObject = configuration.newMetaObject(collectionProperty);
                      targetMetaObject.add(rowValue);
                    } else {
                      //将生成的Cust对象设置到User对象中
                      metaObject.setValue(resultMapping.getProperty(), rowValue);
                    }
                    foundValues = true;
                  }
                }
              }
            } catch (SQLException e) {
              throw new ExecutorException("Error getting nested result map values for '" + resultMapping.getProperty() + "'.  Cause: " + e, e);
            }
          }
        }
        return foundValues;
      }

  
再来看getRowValue是怎么处理Cust对象的,这个getRowValue上前讲Cust对象时的代码一样的，只不过这次是对Cust对象为分析

      private Object getRowValue(ResultSetWrapper rsw, ResultMap resultMap, CacheKey combinedKey, CacheKey absoluteKey, String columnPrefix, Object partialObject) throws SQLException {
        //partialObject，第一、三条为null,第二、四条用是的第一条里的Cust，不为null
        final String resultMapId = resultMap.getId();
        Object resultObject = partialObject;
        if (resultObject != null) {
          //第二、四条记录
          final MetaObject metaObject = configuration.newMetaObject(resultObject);
          putAncestor(absoluteKey, resultObject, resultMapId, columnPrefix);
          //这个时间只需要处理Cust里的内映射就行了，例子中Cust没有内映射，这里将什么都不会发生
          //相当对处理第二、四条记录时，这个方法什么都没做
          applyNestedResultMappings(rsw, resultMap, metaObject, columnPrefix, combinedKey, false);
          ancestorObjects.remove(absoluteKey);
        } else {
          //第一、三条记录
          final ResultLoaderMap lazyLoader = new ResultLoaderMap();
          //实例化
          resultObject = createResultObject(rsw, resultMap, lazyLoader, columnPrefix);
          if (resultObject != null && !typeHandlerRegistry.hasTypeHandler(resultMap.getType())) {
            final MetaObject metaObject = configuration.newMetaObject(resultObject);
            boolean foundValues = resultMap.getConstructorResultMappings().size() > 0;
            if (shouldApplyAutomaticMappings(resultMap, AutoMappingBehavior.FULL.equals(configuration.getAutoMappingBehavior()))) {
              //自动映射
              foundValues = applyAutomaticMappings(rsw, resultMap, metaObject, columnPrefix) || foundValues;
            }        
            //映射result节点
            foundValues = applyPropertyMappings(rsw, resultMap, metaObject, lazyLoader, columnPrefix) || foundValues;
            putAncestor(absoluteKey, resultObject, resultMapId, columnPrefix);
            //内映射，例子中Cust没有内映射
            foundValues = applyNestedResultMappings(rsw, resultMap, metaObject, columnPrefix, combinedKey, true) || foundValues;
            ancestorObjects.remove(absoluteKey);
            foundValues = lazyLoader.size() > 0 || foundValues;
            resultObject = foundValues ? resultObject : null;
          }
          //将新创建的Cust对象加入nestedResultObjects中
          if (combinedKey != CacheKey.NULL_CACHE_KEY) nestedResultObjects.put(combinedKey, resultObject);
        }
        return resultObject;
      }

从上面的代码可以看出，虽然四条记录对应的cust\_id都为cust\_01，按一般的ORM映射来说，在内存中四个User对象的Cust属性应该是同一个，但在这里个例子中会生成两个Cust对象。这是因为nestedResltOjects是用CombineKey，至于为什么这样做，还不知道！  
  

Acct对象映射过程
----------

  
Acct对象映射过程,还是applyNestedResultMapping方法

    private boolean applyNestedResultMappings(ResultSetWrapper rsw, ResultMap resultMap, MetaObject metaObject, String parentPrefix, CacheKey parentRowKey, boolean newObject) {
        boolean foundValues = false;
        for (ResultMapping resultMapping : resultMap.getPropertyResultMappings()) {
          final String nestedResultMapId = resultMapping.getNestedResultMapId();
          if (nestedResultMapId != null && resultMapping.getResultSet() == null) {
            try {
              final String columnPrefix = getColumnPrefix(parentPrefix, resultMapping);
              final ResultMap nestedResultMap = getNestedResultMap(rsw.getResultSet(), nestedResultMapId, columnPrefix);
              CacheKey rowKey = null;
              Object ancestorObject = null;
              if (ancestorColumnPrefix.containsKey(nestedResultMapId)) {
                rowKey = createRowKey(nestedResultMap, rsw, ancestorColumnPrefix.get(nestedResultMapId));
                ancestorObject = ancestorObjects.get(rowKey);
              }
              if (ancestorObject != null) { 
                if (newObject) metaObject.setValue(resultMapping.getProperty(), ancestorObject);
              } else {
                //四条记录都会执行这里
                //四条记录都生成不同的rowKey的,大概为acct_01,acct_02,acct_03,acct_04
                rowKey = createRowKey(nestedResultMap, rsw, columnPrefix);
                
                //parentRowKey为User对象的key
                //四条记录的combinedKey大概为user_01:acct_01,user_01:acct_02,user_02:acct_03,user_01:acct_04
                final CacheKey combinedKey = combineKeys(rowKey, parentRowKey);            
                Object rowValue = nestedResultObjects.get(combinedKey);
                boolean knownValue = (rowValue != null);
                
                //实例化集合属性
                //这里User.accts对象为一个集体，instantiateCollectionPropertyIfAppropriate方法会取出accts属性的值，如果为null则创建一个,并设置到User对象中
                //第一、二、四条记录返回的都是同一个，因为他们对应同一个User对象
                final Object collectionProperty = instantiateCollectionPropertyIfAppropriate(resultMapping, metaObject);            
                if (anyNotNullColumnHasValue(resultMapping, columnPrefix, rsw.getResultSet())) {
                  //生成Acct对象
                  rowValue = getRowValue(rsw, nestedResultMap, combinedKey, rowKey, columnPrefix, rowValue);
                  if (rowValue != null && !knownValue) {
                    if (collectionProperty != null) {
                      final MetaObject targetMetaObject = configuration.newMetaObject(collectionProperty);
                      //加入到集合中
                      targetMetaObject.add(rowValue);
                    } else {
                      metaObject.setValue(resultMapping.getProperty(), rowValue);
                    }
                    foundValues = true;
                  }
                }
              }
            } catch (SQLException e) {
              throw new ExecutorException("Error getting nested result map values for '" + resultMapping.getProperty() + "'.  Cause: " + e, e);
            }
          }
        }
        return foundValues;
      }

      private Object instantiateCollectionPropertyIfAppropriate(ResultMapping resultMapping, MetaObject metaObject) {
        //属性名，这里为accts
        final String propertyName = resultMapping.getProperty();
        //设置值
        Object propertyValue = metaObject.getValue(propertyName);
        if (propertyValue == null) {
          //如果为空，先看他的类型
          Class<?> type = resultMapping.getJavaType();
          if (type == null) {
            type = metaObject.getSetterType(propertyName);
          }
          try {
            if (objectFactory.isCollection(type)) {
              //如果是集合类型
              
              //生成一个集合对象
              propertyValue = objectFactory.create(type);
              
              //设置到User对象中，即User.setAccts(list)方法
              metaObject.setValue(propertyName, propertyValue);
              return propertyValue;
            }
          } catch (Exception e) {
            throw new ExecutorException("Error instantiating collection property for result '" + resultMapping.getProperty() + "'.  Cause: " + e, e);
          }
        } else if (objectFactory.isCollection(propertyValue.getClass())) {
          return propertyValue;
        }
        return null;
      }

  

小结
==

到此，Mybatis是怎么利用ResultSet生成对象的过程已经分析完毕。分为简单映射和复杂映射。

简单映射就是不包含内映射的resultMap

复杂映射就是包含内映射的resultMap。

复杂映射的过程比较复杂，源代码也没有一行注释，本人是写了个实例，再通过eclipse中的debuger一步步来分析的。

> 作者：ashan_li
> 链接：http://suo.im/5G73Rn
