---
title: JUC并发容器之ConcurrentHashMap
tags:
  - Java
  - 并发
  - ConcurrentHashMap
copyright: true
categories:
  - Java并发编程
translate_title: concurrenthashmap-of-juc-concurrent-container
special: JUC
original: true
show_title: juc-concurrenthashmap
date: 2019-09-22 08:43:33
---
我们知道HashMap是线程不安全的，在并发情况下使用HashMap的put操作会导致死循环，因而导致CPU利用率接近100%。导致死循环的原因是HashMap在put操作时，如果put的元素个数已经达到阈值，会对数组进行扩容，把原来的元素移动到新的HashMap上去，也会对链表中的元素进行rehash。就是在复制元素的过程中，如果有并发操作，则会把HashMap的Entry链表形成环形数据结构，一旦形成环形结构，在Entry的next节点永远也不为空，因此在get操作的时候就出现了死循环的情况。既然HashMap是线程不安全的，那么HashTable呢？虽然HashTable能够在并发的情况下保证线程安全，但是在线程竞争激烈的情况下，HashTable的效率是非常低的。HashTable是通过synchronized来实现并发安全的，因此当一个线程访问HashTable的同步方法时，另一个线程将进入阻塞状态不能进行任何操作。因此引入了ConcurrentHashMap，并推荐在并发的情况下使用ConcurrentHashMap。在1.8版本以前，ConcurrentHashMap采用分段锁的概念，使锁更加细化，但是1.8已经改变了这种思路，1.8是利用CAS+Synchronized来保证并发更新的安全，当然底层采用数组+链表+红黑树的存储结构。此篇博客所有源码均来自JDK 1.8。

在开始研究ConcurrentHashMap源码之前，我们先需要了解一些重要的概念：

1. **table:**table是一个数组，默认为null,在第一次put操作时进行初始化，默认初始化的大小为16。它是用来存放Node节点的容器，扩容时的大小总是2的幂次方。

2. **nextTable:**默认为null，扩容时新生成的数组，其大小为原数组的两倍。

3. **sizeCtl:**默认为0，用来控制table的初始化和扩容操作。其值代表如下：

    * **-1：**表示table正在初始化
    * **-N：**表示N-1个线程正在进行扩容操作
    * 其余情况：
        * 如果table未初始化，表示table需要初始化的大小。
        * 如果table初始化完成，表示table的容量，默认是table大小的0.75倍。居然用这个公式算0.75（n - (n >>> 2)）。
    
4. **Node：**key-value键值对。所有插入ConCurrentHashMap的中数据都将会包装在Node中。其中value和next都用volatile修饰，保证并发的可见性。其定义如下：

   ```java
   static class Node < K, V > implements Map.Entry < K, V > {
       final int hash;
       final K key;
       volatile V val;
       volatile Node < K, V > next;
   
       Node(int hash, K key, V val, Node < K, V > next) {
           this.hash = hash;
           this.key = key;
           this.val = val;
           this.next = next;
       }
       /**
      * 省略部分代码...
      */
   }
   ```
   
5. **ForwardingNode：**一个特殊的Node节点，hash值为-1，其中存储nextTable的引用。只有当table发送扩容时ForwardingNode才会发生作用。其源码定义如下：

    ```java
    static final class ForwardingNode < K, V > extends Node < K, V > {
        final Node < K,V > [] nextTable;
        ForwardingNode(Node < K, V > [] tab) {
            super(MOVED, null, null, null);
            this.nextTable = tab;
        }
       /**
       * 省略部分代码...
       */
    }
    ```

6. **TreeNode：**TreeBins中使用的节点。它自身继承了Node。其部分代码如下：

    ```java
    static final class TreeNode<K,V> extends Node<K,V> {
        TreeNode<K,V> parent; 
        TreeNode<K,V> left;  
        TreeNode<K,V> right;
        TreeNode<K,V> prev; 
        boolean red;  
    	
        //构建节点
        TreeNode(int hash, K key, V val, Node<K,V> next,  TreeNode<K,V> parent) {
            super(hash, key, val, next);
            this.parent = parent;
        }
        
        /**
       	 * 省略部分代码...
         */
    }
    ```

7. **TreeBin：**该类并不负责key-value的键值对包装，它用于在链表转换为红黑树时包装TreeNode节点，也就是说ConcurrentHashMap红黑树存放是TreeBin，不是TreeNode。

    ```java
    static final class TreeBin<K,V> extends Node<K,V> {
        TreeNode<K,V> root;
        volatile TreeNode<K,V> first;
        volatile Thread waiter;
        volatile int lockState;
        // values for lockState
        static final int WRITER = 1; // set while holding write lock
        static final int WAITER = 2; // set when waiting for write lock
        static final int READER = 4; // increment value for setting read lock
    
        TreeBin(TreeNode<K,V> b) {
            super(TREEBIN, null, null, null);
            this.first = b;
            TreeNode<K,V> r = null;
            for (TreeNode<K,V> x = b, next; x != null; x = next) {
                next = (TreeNode<K,V>)x.next;
                x.left = x.right = null;
                if (r == null) {
                    x.parent = null;
                    x.red = false;
                    r = x;
                }
                else {
                    K k = x.key;
                    int h = x.hash;
                    Class<?> kc = null;
                    for (TreeNode<K,V> p = r;;) {
                        int dir, ph;
                        K pk = p.key;
                        if ((ph = p.hash) > h)
                            dir = -1;
                        else if (ph < h)
                            dir = 1;
                        else if ((kc == null &&
                                  (kc = comparableClassFor(k)) == null) ||
                                 (dir = compareComparables(kc, k, pk)) == 0)
                            dir = tieBreakOrder(k, pk);
                            TreeNode<K,V> xp = p;
                        if ((p = (dir <= 0) ? p.left : p.right) == null) {
                            x.parent = xp;
                            if (dir <= 0)
                                xp.left = x;
                            else
                                xp.right = x;
                            r = balanceInsertion(r, x);
                            break;
                        }
                    }
                }
            }
            this.root = r;
            assert checkInvariants(root);
        }
        /**
       	 * 省略部分代码...
         */
    }
    ```

在了解了这些重要的概念后，我们先来看看ConcurrentHashMap的数据结构，然后再来分析ConcurrentHashMap的初始化。ConcurrentHashMap的数据结构的数据结构如下图所示

![ConcurrentHashMap的数据结构](http://cdn.zzwzdx.cn/blog/ConcurrentHashMap数据结构.jpg&blog)


### 构造函数

ConcurrentHashMap源码提供给了一系列的构造函数来初始化ConcurrentHashMap。在看构造函数之前，我们先看看构造函数中的一些常量，以增加对构造函数的理解。

#### 构造函数中的常量

```java
//最大可能的表容量，大小为2^30 = 1073741824
private static final int MAXIMUM_CAPACITY = 1 << 30;
//默认的初始表容量。 必须是2的幂（即，至少1）并且最多为MAXIMUM_CAPACITY（2^30）。
private static final int DEFAULT_CAPACITY = 16;
```

#### 构造函数系列

构造函数源码定义如下：

```java
//使用默认初始化表大小（默认值为16）来初始化一个ConcurrentHashMap对象
public ConcurrentHashMap() {}

//通过指定容量大小来初始化一个ConcurrentHashMap对象
public ConcurrentHashMap(int initialCapacity) {
    //初始容量必须大于0,如果传入的值小于0，则抛出异常
    if (initialCapacity < 0)
        throw new IllegalArgumentException();
    int cap = ((initialCapacity >= (MAXIMUM_CAPACITY >>> 1)) ?
        MAXIMUM_CAPACITY : 
        tableSizeFor(initialCapacity + (initialCapacity >>> 1) + 1));
    this.sizeCtl = cap;
}

//通过一个给定的map集合来创建一个ConcurrentHashMap对象
public ConcurrentHashMap(Map < ? extends K, ? extends V > m) {
    this.sizeCtl = DEFAULT_CAPACITY;
    putAll(m);
}

//通过一个指定的容量大小和负载因子来初始化一个ConcurrentHashMap对象
public ConcurrentHashMap(int initialCapacity, float loadFactor) {
    this(initialCapacity, loadFactor, 1);
}

//通过一个指定的容量大小、负载因子和并发更新的线程数量来初始化一个ConcurrentHashMap对象
public ConcurrentHashMap(int initialCapacity,float loadFactor, int concurrencyLevel) {
    if (!(loadFactor > 0.0 f) || initialCapacity < 0 || concurrencyLevel <= 0)
        throw new IllegalArgumentException();
    if (initialCapacity < concurrencyLevel) // Use at least as many bins
        initialCapacity = concurrencyLevel; // as estimated threads
    long size = (long)(1.0 + (long) initialCapacity / loadFactor);
    int cap = (size >= (long) MAXIMUM_CAPACITY) ?
        MAXIMUM_CAPACITY : tableSizeFor((int) size);
    this.sizeCtl = cap;
}
```

tableSizeFor方法的作用是找到大于等于给定容量的最小2的次幂值 ,其源码如下：

```java
private static final int tableSizeFor(int c) {
    //将c-1,赋值给n
    int n = c - 1;
    //n向右无符号移动1位后与原来的n进行位或运算
    n |= n >>> 1;
    //n向右无符号移动2位后与原来的n进行位或运算
    n |= n >>> 2;
    //n向右无符号移动4位后与原来的n进行位或运算
    n |= n >>> 4;
    //n向右无符号移动8位后与原来的n进行位或运算
    n |= n >>> 8;
    //n向右无符号移动16位后与原来的n进行位或运算
    n |= n >>> 16;
    return (n < 0) ? 1 : (n >= MAXIMUM_CAPACITY) ? MAXIMUM_CAPACITY : n + 1;
}
```

第一句n=c-1的作用是，当c正好是2的幂的时候，经过后面的运算后，得到的还是原来的值。这里我们举例说明下，如果此时c的值为8，对应的二进制数为00000000 00000000 00000000 00001000,运行第一句后，得到的n的值为00000000 00000000 00000000 00000111（即8-1=7），n向右无符号移动一位后得到的值为00000000 00000000 00000000 00000011（即3），7与3进行位或运算，等到‭00000000 00000000 00000000 00000111‬（即7）,后面所有位移后再进行位或运算得到的值依然是7，最后执行return语句，返回的值就是8了，与原来输入的值一样。

从上面构造函数中我们发现，ConcurrentHashMap在执行构造函数后，只是对容量大小做了初始化，并不会直接初始化table，而是延缓到第一次put操作。

### table初始化：initTable()

前面已经提到过，table初始化操作会延缓到第一次put行为。但是put是可以并发执行的，Doug Lea是如何实现table只初始化一次的？让我们来看看源码的实现。

```java
private final Node<K,V>[] initTable() {
    Node<K,V>[] tab; int sc;
    while ((tab = table) == null || tab.length == 0) {
        //sizeCtl < 0 表示有其他线程在初始化，该线程必须挂起
        if ((sc = sizeCtl) < 0)
            Thread.yield(); // lost initialization race; just spin
        // 如果该线程获取了初始化的权利，则用CAS将sizeCtl设置为-1，表示本线程正在初始化
        else if (U.compareAndSwapInt(this, SIZECTL, sc, -1)) {
            try {
                //进行初始化
                if ((tab = table) == null || tab.length == 0) {
                    //如果传入了初始化容量，则使用对初始化容量计算后的数据（这个数据必定是2的幂），否则使用默认容器大小16.
                    int n = (sc > 0) ? sc : DEFAULT_CAPACITY;
                    //构建Node类型的数组
                    @SuppressWarnings("unchecked")
                    Node<K,V>[] nt = (Node<K,V>[])new Node<?,?>[n];
                    table = tab = nt;
                    //设置下次扩容的大小 n - (n >>> 2) ==  0.75*n
                    sc = n - (n >>> 2);
                }
            } finally {
                sizeCtl = sc;
            }
            break;
        }
    }
    return tab;
}
```

从上面源码我们可以看到`initTable()`方法的关键就在于sizeCtl这个变量。sizeCtl默认值为0，如果ConcurrentHashMap在实例化时有参数传入，则sizeCtl会是一个2的幂次方的值。如果sizeCtl < 0，则表示有其它线程正在初始化，必须暂停当前线程。如果当前线程获取了初始化table的权限，则使用CAS将sizeCtl的值设置为-1，防止其它线程进行初始化。初始化完成后，将sizeCtl的值设置为0.75*n，表示下次扩容的阈值。

### put操作

当我们在构造了ConcurrentHashMap对象后，就会向ConcurrentHashMap对象中添加键值对。put操作采用CAS+synchronized实现并发插入或更新操作，具体实现如下：

```java
public V put(K key, V value) {
    return putVal(key, value, false);
}

// put和putIfAbsent的实现
final V putVal(K key, V value, boolean onlyIfAbsent) {
    //key 和 value 都不允许为空
    if (key == null || value == null) throw new NullPointerException();
    //对key的hashCode进行hash计算
    int hash = spread(key.hashCode());
    int binCount = 0;
    for (Node < K, V > [] tab = table;;) {
        Node < K, V > f;
        int n, i, fh;
        //如果table为空，则对table进行初始化操作
        if (tab == null || (n = tab.length) == 0)
            tab = initTable();
        //如果table中的i位置没有节点，则直接插入数据,无需加锁
        else if ((f = tabAt(tab, i = (n - 1) & hash)) == null) {
            if (casTabAt(tab, i, null,new Node < K, V > (hash, key, value, null)))
                break; // no lock when adding to empty bin
        // 节点的hash的值为-1，表示当前节点为ForwardingNode类型。
        // 即表示有线程正在进行扩容操作，则先帮助扩容    
        } else if ((fh = f.hash) == MOVED)
            //帮助扩容
            tab = helpTransfer(tab, f);
        else {
            V oldVal = null;
             //对该节点进行加锁处理（hash值相同的链表的头节点），对性能有点影响
            synchronized(f) {
                //如果table中i位置的节点仍然是f,则进入
                if (tabAt(tab, i) == f) {
                    //fh >=0 表示为链表，将节点插入到链表的尾部
                    if (fh >= 0) {
                        binCount = 1;
                        //从头向尾遍历链表
                        for (Node < K, V > e = f;; ++binCount) {
                            K ek;
                            //如果hash和key与e节点的hash和key相等，则替换到e节点的value
                            if (e.hash == hash &&((ek = e.key) == key ||
                                                  (ek != null && key.equals(ek)))) {
                                //e节点原来的值
                                oldVal = e.val;
                                //如果不是putIfAbsent形式,则替换掉原来的值
                                // putIfAbsent形式则当key存在返回false,否则插入并返回true
                                if (!onlyIfAbsent)
                                    e.val = value;
                                break;
                            }
                            Node < K, V > pred = e;
                            //将节点插入到链表尾部
                            if ((e = e.next) == null) {
                                pred.next = new Node < K, V > (hash, key,value, null);
                                break;
                            }
                        }
                    //树节点，按照树的插入操作进行插入    
                    } else if (f instanceof TreeBin) {
                        Node < K, V > p;
                        binCount = 2;
                        if ((p = ((TreeBin < K, V > ) f).putTreeVal(hash, key,value)) != null) {
                            oldVal = p.val;
                            if (!onlyIfAbsent)
                                p.val = value;
                        }
                    }
                }
            }
            if (binCount != 0) {
                // 如果链表长度已经达到临界值8 就需要把链表转换为树结构
                if (binCount >= TREEIFY_THRESHOLD)
                    treeifyBin(tab, i);
                if (oldVal != null)
                    return oldVal;
                break;
            }
        }
    }
    //size++
    addCount(1 L, binCount);
    return null;
}
```

根据上面put操作的源码，我 么来整理下put操作的流程：

* 首先判断key和value的值，保证key和value都不为null;

* 计算key的hash值，方法如下：

    ```java
    static final int spread(int h) {
        return (h ^ (h >>> 16)) & HASH_BITS;
    }
    ```

    通过key确定槽的位置时，如果我们直接使用key.hashCode() &（表长度-1）那么我们实际上只使用了key.hashCode()的低若干位信息，高位不起作用。所以为了key更加的分散，减少冲突，在实际定位槽的位置时，我们会将key.hashCode()再进行spread一下，充分使用key.hashCode()的高16位信息。而spread后的哈希值会存储在结点的hash属性中，便于下一次直接使用。

* 死循环的方式处理节点的插入：

    * 判断table是否为空，如果为null,则进行初始化的操作，其初始化方法为`initTable()`；
    * 根据hash值来确定当前key-value需要插入的位置i,如果i处没有节点，则直接插入到i的位置。这个过程不需要加锁操作。
    * 如果i处存在节点，并且节点的hash值为-1即（(fh = f.hash) == MOVED）表示当前节点f是ForwardingNode类型的节点。即表示有线程正在进行扩容操作，则先帮助线程做扩容的操作。
    * 如果f.hash >= 0 表示是链表结构，则遍历链表，如果链表上存在当前key的节点则替换value，否则插入到链表尾部。如果f是TreeBin类型节点，则按照红黑树的方法更新或者增加节点。
    * 如果链表长度超过TREEIFY_THRESHOLD(默认是8)，则将链表转成红黑树。

* 调用addCount方法，ConcurrentHashMap的size + 1

这里put操作完成

### get操作

ConcurrentHashMap的get方法源码如下：

```java
public V get(Object key) {
    Node<K,V>[] tab; Node<K,V> e, p; int n, eh; K ek;
    //计算hash值
    int h = spread(key.hashCode());
    if ((tab = table) != null && (n = tab.length) > 0 &&
        (e = tabAt(tab, (n - 1) & h)) != null) {
        // 搜索到的节点key与传入的key相同且不为null,直接返回这个节点
        if ((eh = e.hash) == h) {
            if ((ek = e.key) == key || (ek != null && key.equals(ek)))
                return e.val;
        }
        // 如果头节点的 hash 值小于 0，说明正在扩容或者该节点是红黑树
        else if (eh < 0)
            return (p = e.find(h, key)) != null ? p.val : null;
        //链表遍历
        while ((e = e.next) != null) {
            if (e.hash == h &&
                ((ek = e.key) == key || (ek != null && key.equals(ek))))
                return e.val;
        }
    }
    return null;
}
```

get操作的整个逻辑非常清楚：

- 计算hash值
- 判断table是否为空，如果为空，直接返回null
- 根据hash值获取table中的Node节点（tabAt(tab, (n – 1) & h)），然后根据链表或者树形方式找到相对应的节点，返回其value值。

### 删除操作：remove

ConcurrentHashMap的remove方法源码如下：

```java
public V remove(Object key) {
    return replaceNode(key, null, null);
}

final V replaceNode(Object key, V value, Object cv) {
    //计算hash
    int hash = spread(key.hashCode());
    for (Node<K,V>[] tab = table;;) {
        Node<K,V> f; int n, i, fh;
        //如果table为初始化或者通过hash值计算出来的table中i的位置的元素为null,则直接跳出循环返回null
        if (tab == null || (n = tab.length) == 0 ||
            (f = tabAt(tab, i = (n - 1) & hash)) == null)
            break;
        //如果f节点的hash值为-1，表示有其它线程正在进行扩容，先帮助完成扩容，然后再继续执行for循环
        else if ((fh = f.hash) == MOVED)
            tab = helpTransfer(tab, f);
        else {
            V oldVal = null;
            boolean validated = false;
            //加锁操作，防止其它线程对此桶同时进行put,remove,transfer操作
            synchronized (f) {
                //头节点发生改变，就说明当前链表（或红黑树）的头节点已不是f了
                //可能被前面的线程remove掉了或者迁移到新表上了
                //如果被remove掉了，需要重新对链表新的头节点加锁
                if (tabAt(tab, i) == f) {
                    //fh>0,表示该通后面是链表
                    if (fh >= 0) {
                        validated = true;
                        //从前往后遍历链表
                        for (Node<K,V> e = f, pred = null;;) {
                            K ek;
                            //找到hash和key对应相等的节点
                            if (e.hash == hash && ((ek = e.key) == key || 
                                                   (ek != null && key.equals(ek)))) {
                                V ev = e.val;
                                if (cv == null || cv == ev ||
                                    (ev != null && cv.equals(ev))) {
                                    oldVal = ev;
                                    if (value != null)
                                        e.val = value;
                                    else if (pred != null)
                                        //将该节点的前驱节点的next直接赋值为该节点的next节点
                                        pred.next = e.next;
                                    else
                                        //如果删除的节点就是链表的头结点，则将链表的下一个节点放置到table的i位置
                                        setTabAt(tab, i, e.next);
                                }
                                break;
                            }
                            pred = e;
                            //没找到要删除的key,跳出循环直接返回null
                            if ((e = e.next) == null)
                                break;
                        }
                    }
                    //树结构，删除
                    else if (f instanceof TreeBin) {
                        validated = true;
                        TreeBin<K,V> t = (TreeBin<K,V>)f;
                        TreeNode<K,V> r, p;
                        if ((r = t.root) != null &&
                            (p = r.findTreeNode(hash, key, null)) != null) {
                            V pv = p.val;
                            if (cv == null || cv == pv ||
                                (pv != null && cv.equals(pv))) {
                                oldVal = pv;
                                if (value != null)
                                    p.val = value;
                                else if (t.removeTreeNode(p))
                                    setTabAt(tab, i, untreeify(t.first));
                            }
                        }
                    }
                }
            }
            if (validated) {
                if (oldVal != null) {
                    if (value == null)
                        //元素减一
                        addCount(-1L, -1);
                    return oldVal;
                }
                break;
            }
        }
    }
    return null;
}
```

remove操作的逻辑与get操作的逻辑基本相似：

* 计算hash值。
* 判断table是否为空，为空则直接返回null。
* 根据hash值获取table中的Node节点（tabAt(tab, (n – 1) & h)），然后根据链表或者树形方式找到相对应的节点，并将其删除。
* 元素个数减一(调用addCount(-1,-1))

### 更新元素个数操作：addCount

分析完上面put、get和remove方法后，我们看在在put和remove方法里面都调用了addCount方法，该方法的作用是更新ConcurrentHashMap中元素的个数，其源码如下：

```java
private final void addCount(long x, int check) {
    CounterCell[] as; long b, s;
    //U.compareAndSwapLong(this, BASECOUNT, b = baseCount, s = b + x) 每次进来都更新baseCount
    //当put时baseCount+1,当remove时,baseCount-1
    if ((as = counterCells) != null ||
        !U.compareAndSwapLong(this, BASECOUNT, b = baseCount, s = b + x)) {
        CounterCell a; long v; int m;
        boolean uncontended = true;
        // 如果计数盒子不是空 或者 修改 baseCount 失败,则进入执行该if语句
        if (as == null || (m = as.length - 1) < 0 ||
            (a = as[ThreadLocalRandom.getProbe() & m]) == null ||
            !(uncontended =
              U.compareAndSwapLong(a, CELLVALUE, v = a.value, v + x))) {
            //多线程CAS发生失败的时候执行
            fullAddCount(x, uncontended);
            return;
        }
        if (check <= 1)
            return;
        s = sumCount();
    }
    //检查是否需要扩容
    if (check >= 0) {
        Node<K,V>[] tab, nt; int n, sc;
        // 如果map.size() 大于 sizeCtl（达到扩容阈值需要扩容） 且
        // table 不是空；且 table 的长度小于 1 << 30。（可以扩容）
        while (s >= (long)(sc = sizeCtl) && (tab = table) != null &&
               (n = tab.length) < MAXIMUM_CAPACITY) {
            // 根据 length 得到一个标识
            int rs = resizeStamp(n);
            // 如果正在扩容
            if (sc < 0) {
             	// 如果 sc 的低 16 位不等于 标识符（校验异常 sizeCtl 变化了）
			   // 这里 sc == rs + 1 ||  sc == rs + MAX_RESIZERS 这2个条件永远不能为true，因为sc此时是一个负数，但是rs是一个整数。这里可能是作者的一个BUG.
                // 如果 nextTable == null（结束扩容了）
                // 如果 transferIndex <= 0 (已经有足够的线程来完成迁移工作，后面迁移会看到)
                // 结束循环 
                if ((sc >>> RESIZE_STAMP_SHIFT) != rs || sc == rs + 1 ||
                    sc == rs + MAX_RESIZERS || (nt = nextTable) == null ||
                    transferIndex <= 0)
                    break;
                // 如果可以帮助扩容，那么将 sc 加 1. 表示多了一个线程在帮助扩容
                if (U.compareAndSwapInt(this, SIZECTL, sc, sc + 1))
                    // 扩容
                    transfer(tab, nt);
            }
            // 如果sc>0,表示没有线程正在扩容，将 sc 更新：标识符左移 16 位 然后 + 2. 也就是变成一个负数。高 16 位是标识符，低 16 位初始是 2.
            else if (U.compareAndSwapInt(this, SIZECTL, sc,
                                         (rs << RESIZE_STAMP_SHIFT) + 2))
                // 更新 sizeCtl 为负数后，开始扩容。这里这会有一个线程执行transfer(tab, null)方法，其余的线程会执行transfer(tab, nt)方法
                transfer(tab, null);
            s = sumCount();
        }
    }
}
```

从上面代码我 们可以看出，每次操作addCount操作都会对baseCount加1(put操作)或者减1(remove操作)，如果并发较大，则`U.compareAndSwapLong(this, BASECOUNT, b = baseCount, s = b + x)`会执行失败。那么为了提高高并发的时候baseCount可见性失败的问题，又避免一直重试，这样性能会有很大的影响，那么在jdk8的时候是有引入一个类Striped64，其中LongAdder和DoubleAdder就是对这个类的实现。这两个方法都是为解决高并发场景而生的，是AtomicLong的加强版，AtomicLong在高并发场景性能会比LongAdder差。但是LongAdder的空间复杂度会高点。

```java
// See LongAdder version for explanation
private final void fullAddCount(long x, boolean wasUncontended) {
    int h;
    //如果当前线程的probe值为0，则初始化probe的值
    if ((h = ThreadLocalRandom.getProbe()) == 0) {
        ThreadLocalRandom.localInit();      // force initialization
        h = ThreadLocalRandom.getProbe();
        wasUncontended = true;
    }
    boolean collide = false;                // True if last slot nonempty
    for (;;) {
        CounterCell[] as; CounterCell a; int n; long v;
        //如果counterCells不为null且存在有效数据
        if ((as = counterCells) != null && (n = as.length) > 0) {
            if ((a = as[(n - 1) & h]) == null) {
                if (cellsBusy == 0) {            // Try to attach new Cell
                    //如果当前没有CounterCell就创建一个
                    CounterCell r = new CounterCell(x); // Optimistic create
                    //将cellsBusy的值置为1，加锁
                    if (cellsBusy == 0 && U.compareAndSwapInt(this, CELLSBUSY, 0, 1)) {
                        boolean created = false;
                        try {               // Recheck under lock
                            CounterCell[] rs; int m, j;
                            if ((rs = counterCells) != null &&  (m = rs.length) > 0 &&
                                rs[j = (m - 1) & h] == null) {
                                rs[j] = r;
                                created = true;
                            }
                        } finally {
                            //释放cellsBusy锁，让其他线程可以进来
                            cellsBusy = 0;
                        }
                        if (created)
                            break;
                        continue;           // Slot is now non-empty
                    }
                }
                collide = false;
            }
            //wasUncontended为false说明已经发生了竞争，重置为true重新执行上面代码
            else if (!wasUncontended)       // CAS already known to fail
                wasUncontended = true;      // Continue after rehash
            //对cell的value值进行累计x（1）
            else if (U.compareAndSwapLong(a, CELLVALUE, v = a.value, v + x))
                break;
            else if (counterCells != as || n >= NCPU)
                collide = false;            // At max size or stale
            //表明as已经过时，说明cells已经初始化完成，看下面，重置collide为false表明已经存在竞争
            else if (!collide)
                collide = true;
            else if (cellsBusy == 0 &&
                     U.compareAndSwapInt(this, CELLSBUSY, 0, 1)) {
                try {
                    if (counterCells == as) {// Expand table unless stale
                        CounterCell[] rs = new CounterCell[n << 1];
                        for (int i = 0; i < n; ++i)
                            rs[i] = as[i];
                        counterCells = rs;
                    }
                } finally {
                    cellsBusy = 0;
                }
                collide = false;
                continue;                   // Retry with expanded table
            }
            h = ThreadLocalRandom.advanceProbe(h);
        }
        //初始化counterCells
        else if (cellsBusy == 0 && counterCells == as &&
                 U.compareAndSwapInt(this, CELLSBUSY, 0, 1)) {
            boolean init = false;
            try {                           // Initialize table
                if (counterCells == as) {
                    //这里长度是2的原因是其长度一定是2的幂次
                    CounterCell[] rs = new CounterCell[2];
                    rs[h & 1] = new CounterCell(x);
                    counterCells = rs;
                    init = true;
                }
            } finally {
                cellsBusy = 0;
            }
            if (init)
                break;
        }
        //如果上面都不满足，则直接将x累加到baseCount上
        else if (U.compareAndSwapLong(this, BASECOUNT, v = baseCount, v + x))
            break;                          // Fall back on using base
    }
}
```

这里`fullAddCount`方法看着比较复杂，我们来梳理下其逻辑：

* 如果该线程还没获取过随机数，则初始化`ThreadLocalRandom`然后获取一个随机数h;

* 开始死循环

    * 如果counterCells不为null，且其长度不为0，则分为如下几种情况：

        * 如果通过h获取的下标j(j=((n - 1) & h),其中n为counterCells长度)对应的元素为空null:

            * 如果cellsBusy == 0表示未加锁，new一个CounterCell并将其放入到j的位置，并跳出循环
            * 如果cellsBusy !=0,表示有锁，将collide置位false,表示有有竞争。然后继续循环
        * 如果wasUncontended为false,则表示发生了竞争，将wasUncontended设置为true后继续执行
        * 使用CAS更新CELLVALUE的值+x,如果成功，则跳出循环，失败则继续循环
        * 如果counterCells != as || n >= NCPU，表示发生了竞争，将collide设置为false,继续循环
        * 如果 cellsBusy == 0 且加cellsBusy锁成功，则将counterCells扩容，其大小为原来的额2倍，并跳出循环
        * 重新生成随机数h

    * 如果counterCells==null,且CAS成功，则初始化counterCells，默认大小为2，这设置2的原因是counterCells的长度一定要是2的幂次

    * 如果上面都失败了，则尝试CAS更新baseCount的值,失败继续循环

这里看了`addCount`和`fullAddCount`方法后，我们可以预测下ConcurrentHashMap中size方法返回的值应该是baseCount的值加上所有counterCells中CounterCell元素的value的值。我们来看看`size`方法是否和我们预测的一致,size方法源码定义如下：

```java
public int size() {
    long n = sumCount();
    return ((n < 0L) ? 0 : (n > (long)Integer.MAX_VALUE) ? Integer.MAX_VALUE : (int)n);
}

final long sumCount() {
    CounterCell[] as = counterCells; CounterCell a;
    long sum = baseCount;
    if (as != null) {
    	for (int i = 0; i < as.length; ++i) {
    		if ((a = as[i]) != null)
    			sum += a.value;
    	}
    }
    return sum;
}
```

可以看到，这里和我们预测的想法是一致的。在分析了ConcurrentHashMap的常用方法后，我们在来看看其中的一个非常关键的操作，那就是扩容。

### 扩容操作：transfer

扩容是ConcurrentHashMap中一个非常关键的部分，在上面我们分析`addCount`的源码时已经有过接触，首先我们还是先看看扩容方法的源码定义：
    
```java
private final void transfer(Node<K,V>[] tab, Node<K,V>[] nextTab) {
    int n = tab.length, stride;
    // stride 在单核下直接等于 n，多核模式下为 (n>>>3)/NCPU，最小值是 16
    // stride 可以理解为 步长，有 n 个位置是需要进行迁移的，
    // 将这 n 个任务分为多个任务组，每个任务组有 stride 个任务
    if ((stride = (NCPU > 1) ? (n >>> 3) / NCPU : n) < MIN_TRANSFER_STRIDE)
        stride = MIN_TRANSFER_STRIDE; // subdivide range
    // 如果 nextTab 为 null，先进行初始化，初始化的大小为原来长度的2倍
    if (nextTab == null) {            // initiating
        try {
            @SuppressWarnings("unchecked")
            Node<K,V>[] nt = (Node<K,V>[])new Node<?,?>[n << 1];
            nextTab = nt;
        } catch (Throwable ex) {      // try to cope with OOME
            sizeCtl = Integer.MAX_VALUE;
            return;
        }
        nextTable = nextTab;
        //transferIndex 指向原来tab最后一个桶，方便从后向前遍历 
        transferIndex = n;
    }
    int nextn = nextTab.length;
    // 这个构造方法会生成一个Node，key、value 和 next 都为 null，关键是 hash 为 MOVED,MOVED的值为-1
    // 后面我们会看到，原数组中位置 i 处的节点完成迁移工作后，就会将位置 i 处设置为这个 ForwardingNode，用来告诉其他线程该位置已经处理过了
    // 它其实相当于是一个标识
    ForwardingNode<K,V> fwd = new ForwardingNode<K,V>(nextTab);
    boolean advance = true;
    boolean finishing = false; // to ensure sweep before committing nextTab
    //i是位置下标，bound是每个线程处理桶的边界
    for (int i = 0, bound = 0;;) {
        Node<K,V> f; int fh;
        while (advance) {
            int nextIndex, nextBound;
            if (--i >= bound || finishing)
                advance = false;
            // 将 transferIndex 值赋给 nextIndex
            // 这里 transferIndex 一旦小于等于 0，说明原数组的所有位置都有相应的线程去处理了
            else if ((nextIndex = transferIndex) <= 0) {
                i = -1;
                advance = false;
            }
            //分配线程的处理边界
            else if (U.compareAndSwapInt
                     (this, TRANSFERINDEX, nextIndex,
                      nextBound = (nextIndex > stride ?
                                   nextIndex - stride : 0))) {
                // nextBound 是这次迁移任务的边界，是从后往前
                bound = nextBound;
                i = nextIndex - 1;
                advance = false;
            }
        }
        //i<0说明已经遍历完旧的数组tab；i>=n什么时候有可能呢？在下面看到i=n,所以目前i最大应该是n吧。
        //i+n>=nextn,nextn=nextTab.length，所以如果满足i+n>=nextn说明已经扩容完成
        if (i < 0 || i >= n || i + n >= nextn) {
            int sc;
            //扩容完成后，退出循环
            if (finishing) {
                nextTable = null;
                table = nextTab;
                // 重新计算 sizeCtl：n 是原数组长度，所以 sizeCtl 得出的值将是新数组长度的 0.75 倍
                sizeCtl = (n << 1) - (n >>> 1);
                return;
            }
            /**
                 第一个扩容的线程，执行transfer方法之前，会设置 sizeCtl = (resizeStamp(n) << RESIZE_STAMP_SHIFT) + 2)
                 后续帮其扩容的线程，执行transfer方法之前，会设置 sizeCtl = sizeCtl+1
                 每一个退出transfer的方法的线程，即该线程已经完了自己的扩容工作，退出之前，会设置 sizeCtl = sizeCtl-1
                 那么最后一个线程退出时：
                 必然有sc == (resizeStamp(n) << RESIZE_STAMP_SHIFT) + 2)，即 (sc - 2) == resizeStamp(n) << RESIZE_STAMP_SHIFT
                */
            if (U.compareAndSwapInt(this, SIZECTL, sc = sizeCtl, sc - 1)) {
                //不相等，说明不到最后一个线程，直接退出transfer方法
                if ((sc - 2) != resizeStamp(n) << RESIZE_STAMP_SHIFT)
                    return;
                finishing = advance = true;
                i = n; // recheck before commit
            }
        }
        //如果tab的i位置没有节点，则将此处的的节点设置成一个ForwardingNode节点，仅仅起到站位的左右
        //这样做的目的是当其他线程在put操作的时候，正好要放置节点的位置就是当前位置时，需要告诉线程正在进行扩容操作，需要先帮助扩容才能正常添加
        else if ((f = tabAt(tab, i)) == null)
            //CAS设置成功，则继续去做该线程其它位置设定的扩容操作
            advance = casTabAt(tab, i, null, fwd);
        // 该位置处是一个 ForwardingNode，代表该位置已经迁移过了
        else if ((fh = f.hash) == MOVED)
            advance = true; // already processed
        //开始迁移
        else {
            synchronized (f) {
                if (tabAt(tab, i) == f) {
                    Node<K,V> ln, hn;
                    //迁移链表
                    if (fh >= 0) {
                        int runBit = fh & n;
                        Node<K,V> lastRun = f;
                        for (Node<K,V> p = f.next; p != null; p = p.next) {
                            int b = p.hash & n;
                            if (b != runBit) {
                                runBit = b;
                                lastRun = p;
                            }
                        }
                        if (runBit == 0) {
                            ln = lastRun;
                            hn = null;
                        }
                        else {
                            hn = lastRun;
                            ln = null;
                        }
                        //将链表拆分为2个链表，分别为ln和hn
                        for (Node<K,V> p = f; p != lastRun; p = p.next) {
                            int ph = p.hash; K pk = p.key; V pv = p.val;
                            if ((ph & n) == 0)
                                ln = new Node<K,V>(ph, pk, pv, ln);
                            else
                                hn = new Node<K,V>(ph, pk, pv, hn);
                        }
                        //将ln链表放到新table的i位置
                        setTabAt(nextTab, i, ln);
                        //将hn链表放置到新table的i+n的位置
                        setTabAt(nextTab, i + n, hn);
                        //将原table的i位置标记为ForwardingNode节点
                        setTabAt(tab, i, fwd);
                        //继续迁移上一个位置的节点
                        advance = true;
                    }
                    //红黑树迁移，后面再讲
                    else if (f instanceof TreeBin) {
                        TreeBin<K,V> t = (TreeBin<K,V>)f;
                        TreeNode<K,V> lo = null, loTail = null;
                        TreeNode<K,V> hi = null, hiTail = null;
                        int lc = 0, hc = 0;
                        for (Node<K,V> e = t.first; e != null; e = e.next) {
                            int h = e.hash;
                            TreeNode<K,V> p = new TreeNode<K,V>
                                (h, e.key, e.val, null, null);
                            if ((h & n) == 0) {
                                if ((p.prev = loTail) == null)
                                    lo = p;
                                else
                                    loTail.next = p;
                                loTail = p;
                                ++lc;
                            }
                            else {
                                if ((p.prev = hiTail) == null)
                                    hi = p;
                                else
                                    hiTail.next = p;
                                hiTail = p;
                                ++hc;
                            }
                        }
                        ln = (lc <= UNTREEIFY_THRESHOLD) ? untreeify(lo) :
                        (hc != 0) ? new TreeBin<K,V>(lo) : t;
                        hn = (hc <= UNTREEIFY_THRESHOLD) ? untreeify(hi) :
                        (lc != 0) ? new TreeBin<K,V>(hi) : t;
                        setTabAt(nextTab, i, ln);
                        setTabAt(nextTab, i + n, hn);
                        setTabAt(tab, i, fwd);
                        advance = true;
                    }
                }
            }
        }
    }
}
```

至此，迁移中关于链表的部分已经个介绍完成了，下面我们先来整体总结下迁移的逻辑：

*  首先在`put`方法调用`addCount`方法后，如果需要扩容，则第一个线程会执行`transfer(tab, null)`，并且将sizeCtl的值设置为rs << RESIZE_STAMP_SHIFT) + 2。
* 如果有线程并发put操作，如果需要put的元素在table位置的i上存在节点，且节点的hash值为-1，则帮助扩容，则是线程需要执行`transfer(tab, nextTab)`，并将sizeCtl的值设置为U.compareAndSwapInt(this, SIZECTL, sc, sc + 1)，否则直接put操作，则进行帮助扩容。
* 先计算每个线程处理的步长，多核模式下为 (n>>>3)/NCPU，单核模式下为n,但是其最小值是 16。
* 如果是第一个线程执行扩容，则需要创建nextTable，并且其长度为原来table的2倍。
* 分配每个线程执行迁移的区间。
* 如果table数组上i位置没有元素，则将i位置设置为ForwardingNode类型的节点，占据位置。然后再开启迁移（i-1）的位置。
* 如果table数组上i位置存在元素，并且其节点类型为ForwardingNode，则迁移(i-1)的位置。
* 开始迁移i位置的数据：
    * 如果i位置上的节点是链表类型，将链表拆分了2个链表，(node.hash & n) == 0 组成的链表放置在新table（后面就用nextTable代替）的i的位置，(node.hash & n) != 0 组成的链表放置在nextTable的（i+n)的位置上。
    * 如果i位置上的节点是红黑树类型，其迁移操作下一节在讨论。
* 迁移完成后，执行U.compareAndSwapInt(this, SIZECTL, sc = sizeCtl, sc - 1)，表示有一个线程完成了迁移，如果不是最后一个线程，则直接返回。最后一个线程在执行上面代码后，还要在检查一遍才能退出。

到这里我们分析了ConcurrentHashMap的一些常用方法，其中关于红黑树的部分还未涉及，下一篇将分析ConcurrentHashMap中有关于红黑树的有关部分。
