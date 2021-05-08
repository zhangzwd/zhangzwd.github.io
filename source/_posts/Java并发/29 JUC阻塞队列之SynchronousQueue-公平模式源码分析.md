---
title: JUC阻塞队列之SynchronousQueue公平模式源码分析
tags:
  - Java
  - 线程
  - SynchronousQueue
copyright: true
categories:
  - Java并发编程
special: JUC
original: true
show_title: juc-synchronousQueue-fair
translate_title: source-code-analysis-of-synchronousqueue-fair-mode-of-juc-blocking-queue
date: 2019-10-29 09:18:18
---
synchronousQueue是一个不存储元素的阻塞队列。每个put操作必须等待一个take操作，否则不能继续向队列中添加元素。synchronousQueue同样支持公平和非公平性，在默认情况下线程采用非公平性策略进行访问。

### 构造函数

SynchronousQueue提供了2种构造方式，一种是默认的非公平性，一种是可选择公平和非公平性的构造方式，构造函数源码如下：

```java
public SynchronousQueue() {
    this(false);
}

public SynchronousQueue(boolean fair) {
    transferer = fair ? new TransferQueue < E > () : new TransferStack < E > ();
}
```

从上面源码中，我们可以看到，当SynchronousQueue非公平时，使用的是TransferStack这个类来构造的，否则使用的是TransferQueue这个类进行构造，下面我们看看这2个类的实现。

#### TransferQueue

TransferQueue是SynchronousQueue实现公平策略的核心类，其定义如下：

```java
static final class TransferQueue < E > extends Transferer < E > {
    /** 队列头结点 */
    transient volatile QNode head;
    /** 队列尾节点 */
    transient volatile QNode tail;
    // 指向一个取消的结点
    //当一个节点中最后一个插入时，它被取消了但是可能还没有离开队列
    transient volatile QNode cleanMe;

    TransferQueue() {
    	//初始化一个空节点
        QNode h = new QNode(null, false); 
        //将队列的头结点和尾节点都指向这个空节点
        head = h;
        tail = h;
    }
    //省略部分代码....
}
```

从上述TransferQueue的定义中我们可以看出，在TransferQueue中除了头、尾节点外还存在一个cleanMe节点。该节点主要用于标记，当删除的节点是尾节点时则需要使用该节点。 同时，对于TransferQueue需要注意的是，其队列永远都存在一个dummy node(虚拟节点)。在构造创建完TransferQueue后，其头结点和尾节点都指向了一个虚拟节点。而且在TransferQueue中节点的类型是`QNode`类型，它是TransferQueue的一个静态内部类，其源码定义如下：

```java
 static final class QNode {
     // 指向队列中的下一个节点
     volatile QNode next;
     // 数据项 
     volatile Object item;
     //等待线程
     volatile Thread waiter;
     //模式，表示当前是数据还是请求，只有当匹配的模式相匹配时才会交换
     final boolean isData;

     QNode(Object item, boolean isData) {
         this.item = item;
         this.isData = isData;
     }

     /**
      * CAS设置next域
      */
     boolean casNext(QNode cmp, QNode val) {
         return next == cmp &&
             UNSAFE.compareAndSwapObject(this, nextOffset, cmp, val);
     }

     /**
      * CAS 设置item域
      */
     boolean casItem(Object cmp, Object val) {
         return item == cmp &&
             UNSAFE.compareAndSwapObject(this, itemOffset, cmp, val);
     }

     /**
      * 尝试通过CAS将此项目引用取消，将item域设置为自身
      */
     void tryCancel(Object cmp) {
         UNSAFE.compareAndSwapObject(this, itemOffset, cmp, this);
     }

     /**
      * 判断节点是否被缺陷
      * 与tryCancel相照应只需要判断item释放等于自身即可
      */
     boolean isCancelled() {
         return item == this;
     }

     boolean isOffList() {
         return next == this;
     }

     // Unsafe mechanics
     private static final sun.misc.Unsafe UNSAFE;
     private static final long itemOffset;
     private static final long nextOffset;

     static {
         try {
             UNSAFE = sun.misc.Unsafe.getUnsafe();
             Class < ? > k = QNode.class;
             itemOffset = UNSAFE.objectFieldOffset(k.getDeclaredField("item"));
             nextOffset = UNSAFE.objectFieldOffset(k.getDeclaredField("next"));
         } catch (Exception e) {
             throw new Error(e);
         }
     }
 }
```

上面代码逻辑非常清晰，唯一需要注意的一点就是isData，该属性在进行数据交换起到关键性作用，两个线程进行数据交换的时候，必须要两者的模式保持一致,否则不能进行数据交换。

#### TransferStack

TransferStack是SynchronousQueue实现非公平策略的关键类，其定义如下：

```java
static final class TransferStack < E > extends Transferer < E > {
    /* Modes for SNodes, ORed together in node fields */
    /** 节点代表未实现的消费者 */
    static final int REQUEST = 0;
    /** 节点代表未完成的生产者 */
    static final int DATA = 1;
    /** 节点正在执行另一个未完成的数据或请求 */
    static final int FULFILLING = 2;

    /**  如果m设置了满足位，则返回true。 */
    static boolean isFulfilling(int m) { return (m & FULFILLING) != 0; }

    /** 栈的头部 */
    volatile SNode head;

    //省略部分代码...
}
```

TransferStack中定义了三个状态：REQUEST表示消费数据的消费者，DATA表示生产数据的生产者，FULFILLING，表示匹配另一个生产者或消费者。任何线程对TransferStack的操作都属于上述3种状态中的一种（对应着SNode节点的mode）。同时还包含一个head域，表示头结点。 内部节点SNode定义如下：

```java
static final class SNode {
    // next 节点
    volatile SNode next;
    // 相匹配的节点
    volatile SNode match;
    // 等待的线程
    volatile Thread waiter;
    // item 域
    Object item;

    // 模式
    int mode;

    /**
     * item域和mode域不需要使用volatile修饰，因为它们在volatile/atomic操作之前写，之后读
     */
    SNode(Object item) {
        this.item = item;
    }

    boolean casNext(SNode cmp, SNode val) {
        return cmp == next &&
            UNSAFE.compareAndSwapObject(this, nextOffset, cmp, val);
    }

    /**
     * 将s结点与本结点进行匹配，匹配成功，则unpark等待线程
     */
    boolean tryMatch(SNode s) {
        if (match == null &&
            UNSAFE.compareAndSwapObject(this, matchOffset, null, s)) {
            Thread w = waiter;
            if (w != null) { // waiters need at most one unpark
                waiter = null;
                LockSupport.unpark(w);
            }
            return true;
        }
        return match == s;
    }


    void tryCancel() {
        UNSAFE.compareAndSwapObject(this, matchOffset, null, this);
    }

    boolean isCancelled() {
        return match == this;
    }

    // Unsafe mechanics
    private static final sun.misc.Unsafe UNSAFE;
    private static final long matchOffset;
    private static final long nextOffset;

    static {
        try {
            UNSAFE = sun.misc.Unsafe.getUnsafe();
            Class < ? > k = SNode.class;
            matchOffset = UNSAFE.objectFieldOffset(k.getDeclaredField("match"));
            nextOffset = UNSAFE.objectFieldOffset(k.getDeclaredField("next"));
        } catch (Exception e) {
            throw new Error(e);
        }
    }
}
```

上面简单介绍了TransferQueue和TransferStack的基本结构和定义，由于SynchronousQueue的put、take操作都是调用Transfer的transfer()方法，只不过是传递的参数不同而已，put传递的是e参数，所以模式为数据（公平isData = true，非公平mode= DATA），而take操作传递的是null，所以模式为请求（公平isData = false，非公平mode = REQUEST），如下：

```java
 // put操作
 public void put(E e) throws InterruptedException {
     if (e == null) throw new NullPointerException();
     if (transferer.transfer(e, false, 0) == null) {
         Thread.interrupted();
         throw new InterruptedException();
     }
 }

 // take操作
 public E take() throws InterruptedException {
     E e = transferer.transfer(null, false, 0);
     if (e != null)
         return e;
     Thread.interrupted();
     throw new InterruptedException();
 }
```

### 公平模式

在公平模式中调用的方法是TransferQueue中的transfer方法，我们来看看该刚发的源码定义：

```java
E transfer(E e, boolean timed, long nanos) {
    /**
     * 基本算法是循环尝试执行以下两个操作之一：
     * 1.如果队列明显为空或持有相同模式的节点，请尝试将节点添加到等待队列中，直到被匹配或者被取消。
     * 2.如果队列显然包含等待项，并且此调用是互补模式，请尝试通过对等待节点的CAS item字段进行出队并使其出队，然后返回匹配项来实现。
     */
    QNode s = null; 
    // 判断是否是数据模式
    boolean isData = (e != null);

    //死循环
    for (;;) {
        //尾节点
        QNode t = tail;
        //头结点
        QNode h = head;
        //队列还未初始化，则等待
        if (t == null || h == null) 
            continue; // spin
        //如果头为节点相等（队列为空），或者队列尾部节点和请求的节点具有相同的交易类型，那么就将节点添加到队列尾部，并且等待匹配。
        if (h == t || t.isData == isData) { // empty or same-mode
            QNode tn = t.next;
            // 如果此时t!=tail，则表示有其它线程进行了操作修改了tail节点，重新定位尾节点
            if (t != tail) 
                continue;
            // tn != null，表示已经有其他线程添加了节点，tn 推进，重新处理
            if (tn != null) { 
                //尝试推进tn为尾节点
                advanceTail(t, tn);
                continue;
            }
            //  调用的方法的 wait 类型的, 并且 超时了, 直接返回 null
            // timed 在take操作阐述
            if (timed && nanos <= 0) // can't wait
                return null;
            // s == null，构建一个新节点Node   
            if (s == null)
                s = new QNode(e, isData);
            //CAS设置新节点为尾节点，如果CAS失败，则表示有其它线程进行了操作，重新进行
            if (!t.casNext(null, s)) // failed to link in
                continue;
            //尝试推进s为尾节点        
            advanceTail(t, s);
            // 调用awaitFulfill, 若节点是 head.next, 则进行自旋
            // 若不是的话, 直接 block, 直到有其他线程 与之匹配, 或它自己进行线程的中断
            Object x = awaitFulfill(s, e, timed, nanos);
            // 
            if (x == s) { 
                clean(t, s);
                return null;
            }

            //判断结束是否已经从队列中离开
            if (!s.isOffList()) { 
                //尝试将s设置为head
                advanceHead(t, s); 
                if (x != null) // and forget fields
                    s.item = s;
                s.waiter = null;
            }
            return (x != null) ? (E) x : e;

        } else { 
            QNode m = h.next;
            // 不一致读，则表示 有其他线程更改了线程结构，重新开始
            if (t != tail || m == null || h != head)
                continue; 

            Object x = m.item;
            // isData == (x != null)：判断isData与x的模式是否相同，相同表示已经匹配了
            // x == m ：m节点被取消了
            // !m.casItem(x, e)：如果尝试将数据e设置到m上失败
            if (isData == (x != null) ||  x == m || !m.casItem(x, e)) { 
                advanceHead(h, m); 
                continue;
            }
            // 成功匹配了，m设置为头结点h出列，向前推进
            advanceHead(h, m); 
            // 唤醒m上的等待线程
            LockSupport.unpark(m.waiter);
            return (x != null) ? (E) x : e;
        }
    }
}
```

接下来我们看看awaitFulfill这个方法的定义：

```java
Object awaitFulfill(QNode s, E e, boolean timed, long nanos) {
    //如果指定了timed,则时间为System.nanoTime() + nanos，否则为0
    final long deadline = timed ? System.nanoTime() + nanos : 0 L;
    //当前线程
    Thread w = Thread.currentThread();
    ///如果头节点下一个节点是当前s节点(以防止其他线程已经修改了head节点)
    // 则运算(timed ? maxTimedSpins : maxUntimedSpins)，否则直接返回。
    // 指定了timed则使用maxTimedSpins，反之使用maxUntimedSpins
    int spins = ((head.next == s) ? (timed ? maxTimedSpins : maxUntimedSpins) : 0);
    //自旋
    for (;;) {
        //判断当前线程是否中断
        if (w.isInterrupted())
            //尝试取消，将当前节点的item设置为自己(this)
            s.tryCancel(e);
         //获取当前节点的内容   
        Object x = s.item;
        //如果当前节点的值和当前值是否相等，不相等表示节点已经被取出(交易)
        if (x != e)
            return x;
        //计算截止时间   
        if (timed) {
            nanos = deadline - System.nanoTime();
            if (nanos <= 0 L) {
                s.tryCancel(e);
                continue;
            }
        }
        //自旋
        if (spins > 0)
            --spins;
        else if (s.waiter == null)
            //将当前节点的等待线程设置为当前线程
            s.waiter = w;
        else if (!timed)
            //线程阻塞
            LockSupport.park(this);
        else if (nanos > spinForTimeoutThreshold)
            //线程阻塞等待指定纳秒
            LockSupport.parkNanos(this, nanos);
    }
}
```

put操作的`transfer`方法的逻辑比较复杂，这里再次对其进行一次梳理，其整个逻辑流程如下：

1. 获取队列的头结点和尾节点，如果为初始化则自旋等待初始化。
2. 对队列的尾节点进行验证，定位出真正的尾节点，防止其它线程修改了队列后尾节点定位一次。
3. 将当前传入的值构建成为一个新的节点，并将其添加到队列尾部并从新定义尾节点。
4. 然后调用awaitFulfill方法阻塞线程，知道线程被中断或者超时已经消费者消费。
5. 如何消费者消费成功，则将节点从队列中清除。

最后我们举例来说明SynchronousQueue的公平模式的`put`操作。

示例如下：

```java
public class TestSynchronousQueue {
    public static void main(String[] args) throws InterruptedException {
        SynchronousQueue<Integer> queue = new SynchronousQueue<>(true);
        new Thread(()->{
            try {
                queue.put(1);
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
        },"Thread-A").start();
        Thread.sleep(2000);
        new Thread(()->{
            try {
                queue.put(1);
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
        },"Thread-B").start();
        Thread.sleep(2000);
        new Thread(()->{
            Integer take = null;
            try {
                take = queue.take();
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
            System.out.println(take);
        },"Thread-C").start();
    }
}
```

首先上来之后进行的是两次put操作，然后再take操作，默认队列上来会进行初始化，初始化的内容如下代码所示:

```java
TransferQueue() {
    //初始化一个虚拟节点
    QNode h = new QNode(null, false); 
    head = h;
    tail = h;
}
```

初始化后，队列的状态如下：

![初始化](https://gitee.com/zhangzwd/pic-bed/raw/master/blog/put_1.png)



当线程第一次进行`put`操作时，我们来分析下代码

```java
QNode t = tail;
QNode h = head;
if (t == null || h == null) // saw uninitialized value
    continue; // spin
```

首先获取头结点和尾节点，并判断头结点和尾节点是否为空，如果为空则进行自旋，这里我们看到head=tail=虚拟节点。继续执行后面的代码。

```java
//队列为空或者模式相同时进行if语句
if (h == t || t.isData == isData) { 
    QNode tn = t.next;
    // 判断t是否是队尾，不是则重新循环。
    if (t != tail) 
        continue;
    if (tn != null) { 
        advanceTail(t, tn);
        continue;
    }
    // 如果指定了timed并且延时时间用尽则直接返回空，这里操作主要是offer操作时，因为队列无存储空间的当offer时不允许插入。
    if (timed && nanos <= 0) 
        return null;
    // 这里是新节点生成。
    if (s == null)
        s = new QNode(e, isData);
     // 将尾节点的next节点修改为当前节点。
    if (!t.casNext(null, s)) 
        continue;
	// 队尾移动
    advanceTail(t, s);
    //自旋并且设置线程。
    Object x = awaitFulfill(s, e, timed, nanos);
    if (x == s) {
        clean(t, s);
        return null;
    }

    if (!s.isOffList()) { 
        advanceHead(t, s); 
        if (x != null) 
            s.item = s;
        s.waiter = null;
    }
    return (x != null) ? (E) x : e;
}
```

执行完上面代码后，队列情况如下：

 ![](https://gitee.com/zhangzwd/pic-bed/raw/master/blog/put_2 .png)

此时线程A处于自旋状态，如果自旋次数用完后还没有消费者消费在线程进入阻塞状态。接下来是线程B进行操作，这里不进行重复进行，插入第二个元素队列的状况，此时线程B也处于等待状态。

![](https://gitee.com/zhangzwd/pic-bed/raw/master/blog/put_3.png)

上面的主要是put了两次操作后队列的情况，接下来分析一下take操作时又是如何进行操作的，当take操作时，isData为false，而队尾的isData为true两个不相等，所以不会进入到if语句，而是进入到了else语句

```java
else { 
    // 获取头结点的下一个节点，进行互补操作。
    QNode m = h.next; 
    //读取不一致，则从新读取
    if (t != tail || m == null || h != head)
        continue; 
    //获取m节点的值
    Object x = m.item;
    // 如果x==null，表示x节点已经被读取
    // x==m 表m节点已经被删除
    // m.casItem(x, e) 设置x节点的item为null
    if (isData == (x != null) || x == m || !m.casItem(x, e)) {
        //移动头结点到头结点的下一个节点
        advanceHead(h, m); 
        continue;
    }
    //移动头结点到头结点的下一个节点
    advanceHead(h, m); 
    //唤醒节点上等待的线程
    LockSupport.unpark(m.waiter);
    //返回结果
    return (x != null) ? (E) x : e;
}
```

首先获取头结点的下一个节点m用于互补操作，也就是take操作,接下来判断读取是否一致，不一致从新读取。然后判断m节点是否被消费，如果没消费，则移动头结点到下一个节点，并重新消费，如果没有消费，则移动头结点到下一个节点，然后将m的item值修改为null,并且唤醒m节点上阻塞的线程。因此在take()操作执行完后，队列情况如下：

![](https://gitee.com/zhangzwd/pic-bed/raw/master/blog/take.png)

这里需要注意的是，在执行`LockSupport.unpark(m.waiter);`代码后，或唤醒put操作的线程，这里会唤醒线程A，唤醒线程A后会在执行如下代码：

```java
//awaitFulfill方法片段
Object x = s.item;
if (x != e)
    return x;
//transfer方法片段
Object x = awaitFulfill(s, e, timed, nanos);
if (x == s) {                   // wait was cancelled
    clean(t, s);
    return null;
}
//判断节点是否离开了队列
if (!s.isOffList()) { 
    //调节头结点
    advanceHead(t, s); 
    if (x != null) 
        s.item = s;
    s.waiter = null;
}
return (x != null) ? (E) x : e;
```

这里的代码我们可以对照`插入第一个元素`图，s节点也就是当前m节点，获取值得时候已经修改为null，但是当时插入的值时1，所以两个不想等了，则直接返回null值。此时x!=s因此不会执行`clean`方法，接下来会执行`s.isOffList()`来判断节点是否移除了队列，很明显当前节点s并没有离开队列，将waiter设置为null后返回。

### 清除操作

上面分析了正常的take和put操作，接下来我们分析下中断操作，现在在被中断后会执行`s.tryCancel(e)`方法，这个方法的作用的是将QNode节点的item节点赋值为当前QNode，这时候x和e值就不相等了（`if (x != e)`），x的值是s.item，则为当前QNode，而e的值是用户指定的值，这时候返回x(s.item)。返回到函数调用地方`transfer`中，这时候要执行下面语句：

```java
//因为节点s被删除了，所有s.item = s
if (x == s) {                  
    clean(t, s);
    return null;
}
```

执行`clean(t,s)`清理节点，其方法源码如下：

```java
/**
 * 
 * @param pred [要清除节点的前一个节点]
 * @param s    [要清除的节点]
 */
void clean(QNode pred, QNode s) {
    //清除节点等待线程
    s.waiter = null; 
    //判断节点是否正常(如果不正常表示有其它线程已经对队列做了操作)
    while (pred.next == s) { 
        //获取队列的头结点
        QNode h = head;
        //头结点指向的下下一个节点(第一个节点)
        QNode hn = h.next; 
        //如果头结点的下一个节点已经交易过了，则移动头结点
        if (hn != null && hn.isCancelled()) {
            advanceHead(h, hn);
            continue;
        }
        //获取对了的尾节点
        QNode t = tail; 
        //如果队列为空，则退出
        if (t == h)
            return;
        //获取尾节点的下一个节点
        QNode tn = t.next;
        //判断现在的t是不是末尾节点，可能其他线程插入了内容导致不是最后的节点。
        if (t != tail)
            continue;
        //如果不是最后节点的话将其现在t.next节点作为tail尾节点。
        if (tn != null) {
            advanceTail(t, tn);
            continue;
        }
        //如果当前要清除节点不是尾节点进入到这里面。
        if (s != t) { 
            //获取当前节点（被取消的节点）的下一个节点。
            QNode sn = s.next;
            //修改上一个节点的next(下一个)元素为下下个节点。
            if (sn == s || pred.casNext(s, sn))
                return;
        }
        QNode dp = cleanMe;
        if (dp != null) { // 尝试清除上一个标记为清除的节点。
            //获取要清除的节点
            QNode d = dp.next;
            QNode dn;
            if (d == null || // d is gone or
                d == dp || // d is off list or
                !d.isCancelled() || // d not cancelled or
                (d != t && // d not tail and
                    (dn = d.next) != null && //   has successor
                    dn != d && //   that is on list
                    dp.casNext(d, dn))) // d unspliced
                casCleanMe(dp, null);
            if (dp == pred)
                return; // s is already saved node
        } else if (casCleanMe(null, pred))
            return; // Postpone cleaning s
    }
}
```

这里删除分一下3中情况：

1. 如果节点中取消的头结点的下一个节点，只需要移动当前head节点到下一个节点即可。
2. 如果取消的是中间的节点，则将当前节点next节点修改为下下个节点。
3. 如果修改为末尾的节点，则将当前节点放入到QNode的clearMe中，等待有内容进来之后下一次进行清除操作。

这里我们对上面3种方式分别举例说明。

#### 情况一：

清除头结点下一个节点，下面是实例代码进行讲解：

```java
public class TestSynchronousQueue {
    public static void main(String[] args) throws InterruptedException {
        SynchronousQueue<Integer> queue = new SynchronousQueue<>(true);
        Thread threadA = new Thread(()->{
            try {
               queue.put(1);
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
        },"Thread-A");
        threadA.start();
        Thread.sleep(2000);
        Thread threadB = new Thread(()->{
            try {
                queue.put(1);
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
        },"Thread-B");
        threadB.start();
        Thread.sleep(2000);
        
        threadA.interrupt();
    }
}
```

上面例子说明我们启动了两个线程，分别向SynchronousQueue队列中添加了元素1和元素2，添加成功之后的，让主线程休眠一会，然后将第一个线程进行中断操作，添加两个元素后节点所处在的状态为下图所示：

![](https://gitee.com/zhangzwd/pic-bed/raw/master/blog/clean_1.png)

当我们调用`threadA.interrupt();`方法时，线程A的等他消费将会被终止，然后会运行`awaitFulfill`中的代码：

```java
if (w.isInterrupted())
    //将节点的item设置为自己
    s.tryCancel(e);
Object x = s.item;
if (x != e)
    return x;
```

执行完上面代码后，节点状态如下：

![](https://gitee.com/zhangzwd/pic-bed/raw/master/blog/clean_1_1.png)

退出`awaitFulfill`并且返回的是s节点内容（实际上返回的就是s节点），接下来返回到调用`awaitFulfill`的方法`transfer`方法中

```java
//返回的x就是s
Object x = awaitFulfill(s, e, timed, nanos);
if (x == s) { 
    //进入clean方法
    clean(t, s);
    return null;
}
```

进入`clean`方法后运行如下代码

```java
QNode h = head;
QNode hn = h.next; 
//判断头结点的下一个节点不为空，切实删除状态则进入
if (hn != null && hn.isCancelled()) {
    advanceHead(h, hn);
    continue;
}
```

可以看到首先h节点为head节点，hn为头结点的下一个节点，在进行判断头结点的下一个节点不为空并且头结点下一个节点是被中断的节点(取消的节点)，则进入到if语句中，if语句其实也很简单就是将头结点修改为头结点的下一个节点(s节点，别取消节点，并且将前节点的next节点修改为自己，也就是移除了之前的节点，我们看下advanceHead方法：

```java
void advanceHead(QNode h, QNode nh) {
    if (h == head &&
        UNSAFE.compareAndSwapObject(this, headOffset, h, nh))
        h.next = h; // forget old next
}
```

上面`advanceHead`代码比较简单，运行完后，节点状态如下所示：

![](https://gitee.com/zhangzwd/pic-bed/raw/master/blog/clean_1_2.png)

从上图我们看到，队列的原头结点从队列中移除了，并且原队列中头结点的下一个元素转变成了新的头结点，至此清除头结点的下一个节点完成。

#### 情况二

清除中间节点，实例如下：

```java
public class TestSynchronousQueue {
    public static void main(String[] args) throws InterruptedException {
        SynchronousQueue<Integer> queue = new SynchronousQueue<>(true);
        Thread threadA = new Thread(()->{
            try {
               queue.put(1);
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
        },"Thread-A");
        threadA.start();
        Thread.sleep(2000);
        
        Thread threadB = new Thread(()->{
            try {
                queue.put(1);
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
        },"Thread-B");
        threadB.start();
        Thread.sleep(2000);

        Thread threadC = new Thread(()->{
            try {
                queue.put(3);
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
        },"Thread-C");
        threadC.start();
        Thread.sleep(2000);
        
        threadB.interrupt();
    }
}
```

执行完3次put操作后，队列情况如下：

![](https://gitee.com/zhangzwd/pic-bed/raw/master/blog/clean_2.png)

在执行`threadB.interrupt();`后，线程B会从等待中唤醒，然后和情况一相同从`awaitFulfill`方法中返回后进入`clean`方法，代入如下：

```java
QNode t = tail; // Ensure consistent read for tail
if (t == h)
    return;
QNode tn = t.next;
if (t != tail)
    continue;
if (tn != null) {
    advanceTail(t, tn);
    continue;
}
if (s != t) {
    QNode sn = s.next;
    if (sn == s || pred.casNext(s, sn))
        return;
}
```

这里s即线程B所在的节点也就是要清除的节点，很显然`s!=t`成立，进入if语句。然后执行`pred.casNext(s, sn)`将s节点跳过，运行完后，队列情况如下：

![](https://gitee.com/zhangzwd/pic-bed/raw/master/blog/clean_2_1.png)

#### 情况三

清除尾节点，示例如下：

```java
public class TestSynchronousQueue {
    public static void main(String[] args) throws InterruptedException {
        SynchronousQueue<Integer> queue = new SynchronousQueue<>(true);
        Thread threadA = new Thread(()->{
            try {
               queue.put(1);
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
        },"Thread-A");
        threadA.start();
        Thread.sleep(2000);

        Thread threadB = new Thread(()->{
            try {
                queue.put(1);
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
        },"Thread-B");
        threadB.start();
        Thread.sleep(2000);
        threadB.interrupt();
        Thread.sleep(5000);
        
        Thread threadC = new Thread(()->{
            try {
                queue.put(3);
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
        },"Thread-C");
        threadC.start();
        Thread.sleep(2000);

        threadC.interrupt();
    }
}
```

该例子主要说明一个问题就是删除的节点如果是末尾节点的话，`clear`方法又是如何处理的，首先启动第一和第二个线程，然后又将第二个线程中断，这是第二个线程插入的节点为尾节点，然后再启动第三个节点插入值，再中断了第三个节点末尾节点，说一下为啥这样操作，因为当清除尾节点时，并不是直接移除当前节点，而是将被清除的节点的前节点设置到QNode的CleanMe中，等待下次clear方法时进行清除上次保存在CleanMe的节点，然后再处理当前被中断节点，将新的被清理的节点prev设置为cleanMe当中，等待下次进行处理，接下来一步一步分析，首先我们先来看一下第二个线程启动后节点的状态。

![](https://gitee.com/zhangzwd/pic-bed/raw/master/blog/clean_3.png)

然后在执行了`threadB.interrupt();`后，状态如下：

![](https://gitee.com/zhangzwd/pic-bed/raw/master/blog/clean_3_1.png)

然后在线程C执行put操作后，状态如下：

![](https://gitee.com/zhangzwd/pic-bed/raw/master/blog/clean_3_2.png)

然后执行`threadC.interrupt();`后此时`QNode dp = cleanMe;`不为空，因此进入执行下面代码：

```java
if (dp != null) { // Try unlinking previous cancelled node
    QNode d = dp.next;
    QNode dn;
    if (d == null || // d is gone or
        d == dp || // d is off list or
        !d.isCancelled() || // d not cancelled or
        (d != t && // d not tail and
            (dn = d.next) != null && //   has successor
            dn != d && //   that is on list
            dp.casNext(d, dn))) // d unspliced
        casCleanMe(dp, null);
    if (dp == pred)
        return; // s is already saved node
}
```

上面代码逻辑主要如下：

1. 判断d是否为空，如果为空，则表示节点已经清除。
2. 如果cleanMe节点的下一个节点和自己相等，说明需要清除的节点已经离队了。
3. 判断要清除的节点状态是清除状态。
4. 如果上面条件都正确，则执行`(d != t && (dn = d.next) != null && dn != d &&  dp.casNext(d, dn))`，将清除节点前一个节点的next设置为清除节点的后一个节点。

上面逻辑执行完后，队列状态如下：

![](https://gitee.com/zhangzwd/pic-bed/raw/master/blog/clean_3_3.png)

可以看出将上一次标记为清除的节点清除了队列中，再次进入循环，循环之后发现dp为null则会运行`casCleanMe(null, pred)`，此时当前节点s的前一个节点已经被清除队列，但是并不影响后续的清除操作，因为前节点的next节点还在维护中，也是前节点的next指向还是`Reference-Thread-C`,如下图所示：

![](https://gitee.com/zhangzwd/pic-bed/raw/master/blog/clean_3_4.png)

就此SynchronousQueue的公平模式的数据交换分析完毕，如果有不正确的地方请指正。下一篇将分析SynchronousQueue的非公平模式。
