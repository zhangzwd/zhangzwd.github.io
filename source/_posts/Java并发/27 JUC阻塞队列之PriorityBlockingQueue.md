---
title: JUC阻塞队列之PriorityBlockingQueue源码分析
tags:
  - Java
  - 线程
  - PriorityBlockingQueue
copyright: true
categories:
  - Java并发编程
special: JUC
translate_title: source-code-analysis-of-priorityblockingqueue-in-juc
original: true
show_title: juc-priorityBlockingQueue
date: 2019-10-19 12:10:19
---

PriorityBlockingQueue是一个支持优先级的无界队列。默认情况下PriorityBlockingQueue中元素的排列顺序采用自然升序的方式排列。也可以自定义类实现compareTo()方法来执行元素的排列规则，或者在初始化PriorityBlockingQueue时，指定构造参数Comparator来对元素进行排序。需要注意的是PriorityBlockingQueue不能保证同优先级元素的顺序，并且不支持插入null元素也不支持插入非comparable的对象。

PriorityBlockingQueue是基于最小二叉堆实现，对于堆数组中索引为n的节点，其父节点为(n-1)/2，其左右子节点分别为2n+1和2n+2。PriorityBlockingQueue使用ReentrantLock来控制所有公用操作的线程同步，使用基于CAS实现的自旋锁来控制队列的动态扩容，保证了扩容操作不会阻塞take操作的执行。

### 主要成员变量

```java
/**
 * 默认初始容量
 */
private static final int DEFAULT_INITIAL_CAPACITY = 11;

/**
 * 默认最大容量
 * 减8是因为有的VM实现在数组头有些内容
 */
private static final int MAX_ARRAY_SIZE = Integer.MAX_VALUE - 8;

/**
 * 存放最小二叉堆的数组。
 * 父节点下标是n,那么左节点的下标为2n+1，右节点的下标为2n+2。最小的元素在前面
 */
private transient Object[] queue;

/**
 * 比较器
 */
private transient Comparator < ? super E > comparator;

/**
 * 用于同步队列操作的锁
 */
private final ReentrantLock lock;

/**
 * 当队列为空时，阻塞的条件
 */
private final Condition notEmpty;

/**
 * 自旋锁标识字段，通过CAS操作进行比较更新；
 * 用于动态扩容操作；值为1时，表示加锁；为0时，标识未加锁
 */
private transient volatile int allocationSpinLock;

/**
 * 一个普通的PriorityQueue，仅用于序列化
 * 以保持与此类的先前版本的兼容性。仅在序列化/反序列化期间为非null
 */
private PriorityQueue < E > q;
```

### 初始化

PriorityBlockingQueue提供了4种初始化方案，它们分别如下：

* 方案一：无参初始化，源码如下：

    ```java
    public PriorityBlockingQueue() {
        //默认容量大小为11，比较器设置为null
        this(DEFAULT_INITIAL_CAPACITY, null);
    }
    ```

* 方案二：指定初始容量大小初始化，源码如下：

    ```java
    public PriorityBlockingQueue(int initialCapacity) {
        this(initialCapacity, null);
    }
    ```

* 方案三：指定初始容量大小和比较器的初始化，源码如下：

    ```java
    public PriorityBlockingQueue(int initialCapacity,Comparator < ? super E > comparator) {
        // 校验初始容量大小的合法性
        if (initialCapacity < 1)
            throw new IllegalArgumentException();
        // 初始化可重入锁(非公平锁)
        this.lock = new ReentrantLock();
        //队列为空时的阻塞条件
        this.notEmpty = lock.newCondition();
        //初始化比较器
        this.comparator = comparator;
        //初始化数组大小
        this.queue = new Object[initialCapacity];
    }
    ```

* 方案四：指定一个集合的初始化，源码如下：

    ```java
    public PriorityBlockingQueue(Collection < ? extends E > c) {
         // 初始化可重入锁(非公平锁)
        this.lock = new ReentrantLock();
        //队列为空时的阻塞条件
        this.notEmpty = lock.newCondition();
        //默认进行堆有序化
        boolean heapify = true; 
        //默认检查元素中的每个元素
        boolean screen = true;
        //如果传入的集合是SortedSet类型，则不进行堆的有序化
        if (c instanceof SortedSet < ? > ) {
            SortedSet < ? extends E > ss = (SortedSet < ? extends E > ) c;
            //获取比较器
            this.comparator = (Comparator < ? super E > ) ss.comparator();
            heapify = false;
        }
        //若果传入的集合是PriorityBlockingQueue类型，则即不进行堆有序化也不对每个元素进行是否为null的判断
        else if (c instanceof PriorityBlockingQueue < ? > ) {
            PriorityBlockingQueue < ? extends E > pq =
                (PriorityBlockingQueue < ? extends E > ) c;
            //获取比较器    
            this.comparator = (Comparator < ? super E > ) pq.comparator();
            screen = false;
            if (pq.getClass() == PriorityBlockingQueue.class) // exact match
                heapify = false;
        }
        //将传入的集合转变为数组
        Object[] a = c.toArray();
        int n = a.length;
        // If c.toArray incorrectly doesn't return Object[], copy it.
        if (a.getClass() != Object[].class)
            a = Arrays.copyOf(a, n, Object[].class);
        if (screen && (n == 1 || this.comparator != null)) {
            for (int i = 0; i < n; ++i)
                if (a[i] == null)
                    throw new NullPointerException();
        }
        this.queue = a;
        this.size = n;
        if (heapify)
            heapify();
    }
    ```
    

介绍完PriorityBlockingQueue的初始化后，我们来看看它的入列和出列操作。

### 入列操作

PriorityBlockingQueue的入列操作提供了4中方法，分别如下：

* `add(E e):`调用`offer`方法实现
* `offer(E e):`队列满时返回false；由于为无界队列，因而不会返回false；
* `put(E e):`队列满时阻塞；由于为无界队列，因而不会阻塞；代码实现直接调用offer方法；
* `offer(E e, long timeout, TimeUnit unit):`队列满时阻塞等待直至超时或者数组有空出位置；由于为无界队列，因而不会返回false、超时、阻塞；代码实现直接调用offer方法；

```java
/**
 * 直接由offer方法实现
 * @param  e [要插入的元素]
 * @return   [队列满时返回false,由于是无界队列，因此永远不会返回false]
 */
public boolean add(E e) {
    return offer(e);
}

/**
 * @param  e [要插入的元素]
 * @return   [队列满时返回false,由于是无界队列，因此永远不会返回false]
 */
public boolean offer(E e) {
	//检查元素合法性
    if (e == null)
        throw new NullPointerException();
    //获取可重入锁
    final ReentrantLock lock = this.lock;
    //加锁
    lock.lock();
    int n, cap;
    Object[] array;
    //如果队列满，则扩容
    while ((n = size) >= (cap = (array = queue).length))
        tryGrow(array, cap);
    try {
    	//获取比较器
        Comparator < ? super E > cmp = comparator;
        //若果比较器为null,则调用siftUpComparable方法
        if (cmp == null)
            siftUpComparable(n, e, array);
        else
        	//否则调用siftUpUsingComparator方法
            siftUpUsingComparator(n, e, array, cmp);
        size = n + 1;
        //唤醒阻塞的线程
        notEmpty.signal();
    } finally {
    	//是否锁
        lock.unlock();
    }
    return true;
}

/**
 * 由于是无界队列，永远不会被阻塞
 */
public void put(E e) {
    offer(e); // never need to block
}

/**
 * 由于是无界队列，因而不存在阻塞、超时和返回false的情况；
 */
public boolean offer(E e, long timeout, TimeUnit unit) {
    return offer(e); // never need to block
}
```

入列操作实际只有一个`offer(E e)`方法，而`offer(E e)`方法的核心逻辑实在`siftUpComparable`方法和`siftUpUsingComparator`方法里面。下面我们来分析这2个方法。

####  siftUpComparable 和 siftUpUsingComparator 操作

siftUpComparable和siftUpUsingComparator方法都是上浮方法，所谓的上浮方法即每次和根节点进行比价，如果插入的节点比当前的根节点小，则再次和根节点的父根节点进行比较，直到root节点。这里大家可能会有疑惑，PriorityBlockingQueue的底层数基于数组的，哪来的根节点呢？这是因为PriorityBlockingQueue的底层是数组不假，但这个数组是最小二叉堆的实现，对这里有疑惑的同学，可以先看看最小二叉堆的数据结构就很清楚了，LZ在这里就不分析最小二叉堆的结构了。siftUpComparable和siftUpUsingComparator的区别在于在元素比较上siftUpComparable使用的是compareTo方法而siftUpUsingComparator使用的是compare方法。下面我们来分析siftUpComparable & siftUpUsingComparator的源码。

```java
/**
 * [上浮操作，元素必须实现Comparable接口]
 * @param  k     [元素代插入的位置]
 * @param  x     [元素]
 * @param  array [队列]
 * @return       
 */
private static < T > void siftUpComparable(int k, T x, Object[] array) {
    //元素必须实现Comparable接口，否则会抛出异常
    Comparable < ? super T > key = (Comparable < ? super T > ) x;
    // 循环查找节点待插入位置
    while (k > 0) {
        // 找到K位置的父节点下标
        int parent = (k - 1) >>> 1;
        //获取k的父节点的值
        Object e = array[parent];
        //和父节点进行比较
        if (key.compareTo((T) e) >= 0)
            //如果x比根元素大，则跳出while循环
            break;
        //否则，将parent处的节点方到k的位置
        array[k] = e;
        //将parent给k
        k = parent;
    }
    //将x放置到k的位置
    array[k] = key;
}

/**
 * [上浮操作，基于Comparator，逻辑和siftUpComparable一样]
 * @param  k     [元素代插入的位置]
 * @param  x     [元素]
 * @param  array [队列]
 * @return      
 */
private static < T > void siftUpUsingComparator(int k, T x, Object[] array,
    Comparator < ? super T > cmp) {
    while (k > 0) {
        int parent = (k - 1) >>> 1;
        Object e = array[parent];
        if (cmp.compare(x, (T) e) >= 0)
            break;
        array[k] = e;
        k = parent;
    }
    array[k] = x;
}
```

入列流程如下，假设此时队列中的元素为[5,6,7,8,9,10]，那么对于最新二叉堆的结构如下所示：

![](http://cdn.zzwzdx.cn/blog/最小二叉堆.png&blog)

如果此时需要向队列中插入元素4时，即x=4，k=6。此时节点x先和k的父节点的值进行比较大小，当`x>=k的父节点的值`时，将x放入到k的位置，即array[k] = x;在最小二叉堆中即表现为节点7的右孩子为x。当`x<k的父节点的值`时，则将K的父节点的值放入到k的位置，如下所示：

![](http://cdn.zzwzdx.cn/blog/入列操作2.png&blog) 

上述操作完成后，k=2，x=4。x继续和k的父节点比价，即x和5进行比价，发现x<5,则将5放置到k的位置。如下图所示：

![](http://cdn.zzwzdx.cn/blog/入列操作3.png&blog)
上述操作完成后，k=0,x=4。则直接将x放置到k的位置。如下锁所示:

![](http://cdn.zzwzdx.cn/blog/入列操作4.png&blog)
此时队列中数据在数组中的展示顺序为[4,6,5,8,9,10,7]

### 出列操作

同入列操作一样，PriorityBlockingQueue也提供了3种出列操作，它们分别如下：

* `E poll():`队列为空时，直接返回null，不会阻塞；
* `E take():`队列为空时，阻塞直至有元素添加到队列中；
* `E poll(long timeout, TimeUnit unit):`队列为空时，阻塞直至超时或者有元素添加到队列中；

出列操作的源码定义如下：

```java
public E poll() {
    final ReentrantLock lock = this.lock;
    lock.lock();
    try {
        //调用dequeue方法
        return dequeue();
    } finally {
        lock.unlock();
    }
}

public E take() throws InterruptedException {
    //获取锁
    final ReentrantLock lock = this.lock;
    //加锁
    lock.lockInterruptibly();
    E result;
    try {
        //获取数据
        while ((result = dequeue()) == null)
            //如果获取的数据为null,则等待
            notEmpty.await();
    } finally {
        //释放锁
        lock.unlock();
    }
    return result;
}

public E poll(long timeout, TimeUnit unit) throws InterruptedException {
    long nanos = unit.toNanos(timeout);
    final ReentrantLock lock = this.lock;
    lock.lockInterruptibly();
    E result;
    try {
        while ((result = dequeue()) == null && nanos > 0)
            //等待nanos
            nanos = notEmpty.awaitNanos(nanos);
    } finally {
        lock.unlock();
    }
    return result;
}
```

从上述源码中我们可以看到，出列操作的逻辑比较简单，其的核心方法是`dequeue`方法，接下来我们看看`dequeue`的源码定义：

```java
private E dequeue() {
    //n为最后一个元素的下标
    int n = size - 1;
    //若果n<0，表示队列中没有元素，返回null
    if (n < 0)
        return null;
    else {
        //获取到队列数组
        Object[] array = queue;
        //取出队列中的第一个元素
        E result = (E) array[0];
        //取出队列中的最后一个元素
        E x = (E) array[n];
        //将队列中的最后一个元素设置为null
        array[n] = null;
        //构造队列是，是否有传入比较器
        Comparator < ? super E > cmp = comparator;
        if (cmp == null)
            //如果没有传入，则使用siftDownComparable进行下沉操作
            siftDownComparable(0, x, array, n);
        else
            //如果传入了比较器，则使用siftDownUsingComparator进行下沉操作
            siftDownUsingComparator(0, x, array, n, cmp);
        //给size赋值
        size = n;
        //返回元素
        return result;
    }
}
```

从源码中我们可以看到，`dequeue`方法的逻辑就是取出队列中的第一个元素，然后进行下沉操作。那么我们看看下沉操作到底做了什么处理呢？下沉操作源码如下：

```java
/**
 * 下沉操作，将元素x,插入到k的位置
 * 下沉操作的目的是维持最小二叉堆
 * @param  k     [要插入的位置]
 * @param  x     [插入的元素]
 * @param  array [数组]
 * @param  n     [数字中元素的个数]
 * @return       
 */
private static < T > void siftDownComparable(int k, T x, Object[] array, int n) {
    //确保队列中曾在元素
    if (n > 0) {
        Comparable < ? super T > key = (Comparable < ? super T > ) x;
        //队列中元素个数的一半
        int half = n >>> 1; // loop while a non-leaf
        while (k < half) {
            //获取k位置的左孩子节点的下标
            int child = (k << 1) + 1; // assume left child is least
            //获取k位置的左孩子节点的值
            Object c = array[child];
            //k位置右孩子的下标
            int right = child + 1;
            //如果左孩子的值比右孩子的值大
            if (right < n &&
                ((Comparable < ? super T > ) c).compareTo((T) array[right]) > 0)
                //设置有右孩子节点的值为c
                c = array[child = right];
            //如果
            if (key.compareTo((T) c) <= 0)
                break;
            //把c的值赋值到k的位置上
            array[k] = c;
            //将child赋值给k
            k = child;
        }
        //将key的值赋值到k位置上
        array[k] = key;
    }
}

private static < T > void siftDownUsingComparator(int k, T x, Object[] array, int n, Comparator < ? super T > cmp) {
    if (n > 0) {
        int half = n >>> 1;
        while (k < half) {
            int child = (k << 1) + 1;
            Object c = array[child];
            int right = child + 1;
            if (right < n && cmp.compare((T) c, (T) array[right]) > 0)
                c = array[child = right];
            if (cmp.compare(x, (T) c) <= 0)
                break;
            array[k] = c;
            k = child;
        }
        array[k] = x;
    }
}
```

`siftDownUsingComparator`方法和`siftDownComparable`方法的逻辑一样，唯一的区别就是比较器的不同。下沉操作的目的是为了保持二叉堆，那我们看看它是如何维护的？我们还以以上面插入操作的数据为例。在上面插入操作完成后，队列中数组为：[4,6,5,8,9,10,7]。二叉堆的表现如下：

![](http://cdn.zzwzdx.cn/blog/入列操作4.png&blog)

此时，我们第一次做出列操作，返回的元素是4，然后队列做下沉操作。此时，k=0;x=7,arrar=[4,6,5,8,9,10],n=6,那么half=3。k<half成立，进入while，那么child = 2k+1 = 1,c=array[child] = 6,right = child+1 = 2。此时条件`right < n &&    ((Comparable<? super T>) c).compareTo((T) array[right]) > 0`成立，则c=array[child=right]=5。然后array[k]=c,即array[0]=5。此时二叉堆如下： 

![](http://cdn.zzwzdx.cn/blog/出列操作1.1.png&blog)

执行完第一遍后,k=2。继续while循环。此时child = 2k+1 = 5,c=array[child]=10,right=child+1 = 6。此时条件`right < n && ((Comparable<? super T>) c).compareTo((T) array[right]) > 0`不成立，而条件`key.compareTo((T) c) <= 0`成立，跳出while循环，然后把key赋值到k位置，即array[2]=7。

![](http://cdn.zzwzdx.cn/blog/出列操作1.2.png&blog)

我们看到，在第一次出来操作后，经过下沉操作，任然维持二叉堆不变呢。

第二次出列操作返回的是5，第三次是6，第四次是7，第五次是8，第六次是9，第7次是10。出列操作是按照从小到大的顺依次弹出，有兴趣的同学可以Debug看看。

### 查看队列头部元素操作

查看队列头部元素操作只有一个，那就是`peek`方法，其源码定义如下：

```java
public E peek() {
    final ReentrantLock lock = this.lock;
    lock.lock();
    try {
        return (size == 0) ? null : (E) queue[0];
    } finally {
        lock.unlock();
    }
}
```

`peek`方法非常简单，就是返回数组的第一个元素，但是并不会将第一个元素出队列。

### 扩容操作

PriorityBlockingQueue扩容一般是括50%，但是在队列元素小于64的时候，扩容原来的元素个数+2。扩容操作的源码如下：

```java
private void tryGrow(Object[] array, int oldCap) {
    //必须先释放锁，因为在做扩容操作前肯定是先获取了锁的
    lock.unlock(); // must release and then re-acquire main lock
    Object[] newArray = null;
    //CAS方式获取扩容操作的权限
    if (allocationSpinLock == 0 &&
        UNSAFE.compareAndSwapInt(this, allocationSpinLockOffset, 0, 1)) {
        try {
            //扩容
            int newCap = oldCap + ((oldCap < 64) ?
                (oldCap + 2) : // grow faster if small
                (oldCap >> 1));
            //若果扩容后的大小比最大的队列长度还要大
            if (newCap - MAX_ARRAY_SIZE > 0) { // possible overflow
                int minCap = oldCap + 1;
                //如果minCap<0,表示已经超出了int的范围，获取minCap > MAX_ARRAY_SIZE，则抛出OutOfMemoryError异常
                if (minCap < 0 || minCap > MAX_ARRAY_SIZE)
                    throw new OutOfMemoryError();
                newCap = MAX_ARRAY_SIZE;
            }
            //这里 queue == array，是为了确保没有做出列操作。
            if (newCap > oldCap && queue == array)
                newArray = new Object[newCap];
        } finally {
            allocationSpinLock = 0;
        }
    }
    //如果CAS失败，则让出CPU执行时间
    if (newArray == null) // back off if another thread is allocating
        Thread.yield();
    //加锁    
    lock.lock();
    if (newArray != null && queue == array) {
        // 将原来数组上的值，拷贝到新的数组上去
        queue = newArray;
        System.arraycopy(array, 0, newArray, 0, oldCap);
    }
}
```

我们看到，扩容操作在计算新数组的长度的时候，使用的是CAS的方式，并没有使用重入锁。这是为了如果在扩容时，有出列操作，则没有必要进行扩容，省去了不必要的开销。



