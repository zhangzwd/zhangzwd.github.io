---
title: JUC并发工具之Exchanger源码解析
tags:
  - Java
  - 并发
  - Exchanger
copyright: true
categories:
  - Java并发编程
translate_title: exchange-source-code-analysis-of-juc-concurrent-tools
special: JUC
original: true
show_title: juc-exchanger
date: 2019-09-21 09:11:17
---

#### 实现原理

Exchanger(交换者)是用于线程协作的工具类。Exchanger用于进行两个线程之间的数据交换。它提供一个同步点，在这个同步点，两个线程可以交换彼此的数据。这两个线程通过exchange()方法交换数据，当一个线程先执行exchange()方法后，它会一直等待第二个线程也执行exchange()方法，当这两个线程到达同步点时，这两个线程就可以交换数据了。

Exchanger的算法核心是通过一个可以交换数据的slot和一个可以带有数据item的参与者，在源码中的定义如下：

```java
for (;;) {
    if (slot is empty) { // offer
        // slot为空时，将item 设置到Node 中        
        place item in a Node;
        if (can CAS slot from empty to node) {
            // 当将node通过CAS交换到slot中时，挂起线程等待被唤醒
            wait for release;
            // 被唤醒后返回node中匹配到的item
            return matching item in node;
        }
    } else if (can CAS slot from node to empty) { // release
         // 将slot设置为空
        // 获取node中的item，将需要交换的数据设置到匹配的item
        get the item in node;
        set matching item in node;
        // 唤醒等待的线程
        release waiting thread;
    }
    // else retry on CAS failure
}
```

比如有2条线程A和B，A线程交换数据时，发现slot为空，则将需要交换的数据放在slot中等待其它线程进来交换数据，等线程B进来，读取A设置的数据，然后设置线程B需要交换的数据，然后唤醒A线程，原理就是这么简单。但是当多个线程之间进行交换数据时就会出现问题，所以Exchanger加入了slot数组。

Exchanger中定义了几个重要的成员变量,它们分别是：

```java
private final Participant participant;
private volatile Node[] arena;
private volatile Node slot;
```

participant的作用是为每个线程保留唯一的一个Node节点。slot为单个槽，arena为数组槽。他们都是Node类型。这里arena存在的意义是当有多个参与者使用同一个交换场所时，会存在严重伸缩性问题。既然单个交换场所存在问题，那么我们就安排多个，也就是数组arena。通过数组arena来安排不同的线程使用不同的slot来降低竞争问题，并且可以保证最终一定会成对交换数据。但是Exchanger不是一来就会生成arena数组来降低竞争，只有当产生竞争时才会生成arena数组。那么怎么将Node与当前线程绑定呢？Participant ，Participant 的作用就是为每个线程保留唯一的一个Node节点，它继承ThreadLocal，同时在Node节点中记录在arena中的下标index

Node的数据结构如下：

```java
@sun.misc.Contended static final class Node {
     // arena的下标，多个槽位的时候利用
    int index; 
    // 上一次记录的Exchanger.bound
    int bound; 
    // 在当前bound下CAS失败的次数；
    int collides;
    // 用于自旋；
    int hash; 
    // 这个线程的当前项，也就是需要交换的数据；
    Object item; 
    //做releasing操作的线程传递的项；
    volatile Object match; 
    //挂起时设置线程值，其他情况下为null；
    volatile Thread parked;
}
```

Exchanger的核心方法为`exchange(V x)`，下面我们就来分析下`exchange(V x)`方法。

#### exchange(V x)方法

**exchange(V x)**：等待另一个线程到达此交换点（除非当前线程被中断），然后将给定的对象传送给该线程，并接收该线程的对象。方法定义如下：

```java
public V exchange(V x) throws InterruptedException {
    Object v;
    // 当参数为null时需要将item设置为空的对象
    Object item = (x == null) ? NULL_ITEM : x; // translate null args
    // 注意到这里的这个表达式是整个方法的核心
    if ((arena != null ||
            (v = slotExchange(item, false, 0 L)) == null) &&
        ((Thread.interrupted() || // disambiguates null return
            (v = arenaExchange(item, false, 0 L)) == null)))
        throw new InterruptedException();
    return (v == NULL_ITEM) ? null : (V) v;
}
```

仔细分析上述方法中的if语句，可以得知：

* 只有当arena 为空时，才执行slotExchange(item, false, 0 L)方法。
* 当arena不为空时，或者(arena为null且slotExchange方法返回null)时，此时线程未中断，才会执行arenaExchange方法;
* 线程中断时，就直接抛出线程中断异常。

下面我们再看看slotExchange方法，其定义如下：

```java
private final Object slotExchange(Object item, boolean timed, long ns) {
    // 获取当前线程node对象
    Node p = participant.get();
    // 当前线程
    Thread t = Thread.currentThread();
    // 若果线程被中断，就直接返回null
    if (t.isInterrupted()) // preserve interrupt status so caller can recheck
        return null;
	// 自旋
    for (Node q;;) {
        // 将slot值赋给q
        if ((q = slot) != null) {
             // slot 不为null，即表示已有线程已经把需要交换的数据设置在slot中了
			// 通过CAS将slot设置成null
            if (U.compareAndSwapObject(this, SLOT, q, null)) {
                // CAS操作成功后，将slot中的item赋值给对象v，以便返回。
                // 这里也是就读取之前线程要交换的数据
                Object v = q.item;
                // 将当前线程需要交给的数据设置在q中的match
                q.match = item;
                 // 获取被挂起的线程
                Thread w = q.parked;
                if (w != null)
                    // 如果线程不为null，唤醒它
                    U.unpark(w);
                // 返回其他线程给的V
                return v;
            }
            // create arena on contention, but continue until slot null
            // CAS 操作失败，表示有其它线程竞争，在此线程之前将数据已取走
            // NCPU:CPU的核数
            // bound == 0 表示arena数组未初始化过，CAS操作bound将其增加SEQ
            if (NCPU > 1 && bound == 0 &&
                U.compareAndSwapInt(this, BOUND, 0, SEQ))
                // 初始化arena数组
                arena = new Node[(FULL + 2) << ASHIFT];
        }
        // 上面分析过，只有当arena不为空才会执行slotExchange方法的
		// 所以表示刚好已有其它线程加入进来将arena初始化
        else if (arena != null)
            // 这里就需要去执行arenaExchange
            return null; // caller must reroute to arenaExchange
        else {
            // 这里表示当前线程是以第一个线程进来交换数据
            // 或者表示之前的数据交换已进行完毕，这里可以看作是第一个线程
            // 将需要交换的数据先存放在当前线程变量p中
            p.item = item;
            // 将需要交换的数据通过CAS设置到交换区slot
            if (U.compareAndSwapObject(this, SLOT, null, p))
                // 交换成功后跳出自旋
                break;
            // CAS操作失败，表示有其它线程刚好先于当前线程将数据设置到交换区slot
            // 将当前线程变量中的item设置为null，然后自旋获取其它线程存放在交换区slot的数据
            p.item = null;
        }
    }

    // await release
    // 执行到这里表示当前线程已将需要的交换的数据放置于交换区slot中了，
    // 等待其它线程交换数据然后唤醒当前线程
    int h = p.hash;
    long end = timed ? System.nanoTime() + ns : 0 L;
    // 自旋次数
    int spins = (NCPU > 1) ? SPINS : 1;
    Object v;
    // 自旋等待直到p.match不为null，也就是说等待其它线程将需要交换的数据放置于交换区slot
    while ((v = p.match) == null) {
        // 下面的逻辑主要是自旋等待，直到spins递减到0为止
        if (spins > 0) {
            h ^= h << 1;
            h ^= h >>> 3;
            h ^= h << 10;
            if (h == 0)
                h = SPINS | (int) t.getId();
            else if (h < 0 && (--spins & ((SPINS >>> 1) - 1)) == 0)
                Thread.yield();
        } else if (slot != p)
            spins = SPINS;
        // 此处表示未设置超时或者时间未超时
        else if (!t.isInterrupted() && arena == null &&
            (!timed || (ns = end - System.nanoTime()) > 0 L)) {
            // 设置线程t被当前对象阻塞
            U.putObject(t, BLOCKER, this);
            // 给p挂机线程的值赋值
            p.parked = t;
            if (slot == p)
                // 如果slot还没有被置为null，也就表示暂未有线程过来交换数据，需要将当前线程挂起
                U.park(false, ns);
            // 线程被唤醒，将被挂起的线程设置为null
            p.parked = null;
            // 设置线程t未被任何对象阻塞
            U.putObject(t, BLOCKER, null);
        // 不是以上条件时（可能是arena已不为null或者超时）    
        } else if (U.compareAndSwapObject(this, SLOT, p, null)) {
             // arena不为null则v为null,其它为超时则v为超市对象TIMED_OUT，并且跳出循环
            v = timed && ns <= 0 L && !t.isInterrupted() ? TIMED_OUT : null;
            break;
        }
    }
    // 取走match值，并将p中的match置为null
    U.putOrderedObject(p, MATCH, null);
    // 设置item为null
    p.item = null;
    p.hash = h;
    // 返回交换值
    return v;
}
```

再来看arenaExchange方法，此方法被执行时表示多个线程进入交换区交换数据，arena数组已被初始化，此方法中的一些处理方式和slotExchange比较类似，它是通过遍历arena数组找到需要交换的数据。arenaExchange方法源码定义如下：

```java
// timed 为true表示设置了超时时间，ns为>0的值，反之没有设置超时时间
private final Object arenaExchange(Object item, boolean timed, long ns) {
    Node[] a = arena;
    // 获取当前线程中的存放的node
    Node p = participant.get();
    //index初始值0
    for (int i = p.index;;) { // access slot at i
        // 遍历，如果在数组中找到数据则直接交换并唤醒线程，如未找到则将需要交换给其它线程的数据放置于数组中
        int b, m, c;
        long j; // j is raw array offset
        // 其实这里就是向右遍历数组，只是用到了元素在内存偏移的偏移量
        // q实际为arena数组偏移(i + 1) *  128个地址位上的node
        Node q = (Node) U.getObjectVolatile(a, j = (i << ASHIFT) + ABASE);
        // 如果q不为null，并且CAS操作成功，将下标j的元素置为null
        if (q != null && U.compareAndSwapObject(a, j, q, null)) {
            // 表示当前线程已发现有交换的数据，然后获取数据，唤醒等待的线程
            Object v = q.item; // release
            q.match = item;
            Thread w = q.parked;
            if (w != null)
                U.unpark(w);
            return v;
        // q 为null 并且 i 未超过数组边界    
        } else if (i <= (m = (b = bound) & MMASK) && q == null) {
             // 将需要给其它线程的item赋予给p中的item
            p.item = item; // offer
            if (U.compareAndSwapObject(a, j, null, p)) {
                // 交换成功
                long end = (timed && m == 0) ? System.nanoTime() + ns : 0 L;
                Thread t = Thread.currentThread(); // wait
                // 自旋直到有其它线程进入，遍历到该元素并与其交换，同时当前线程被唤醒
                for (int h = p.hash, spins = SPINS;;) {
                    Object v = p.match;
                    if (v != null) {
                        // 其它线程设置的需要交换的数据match不为null
                        // 将match设置null,item设置为null
                        U.putOrderedObject(p, MATCH, null);
                        p.item = null; // clear for next use
                        p.hash = h;
                        return v;
                    } else if (spins > 0) {
                        h ^= h << 1;
                        h ^= h >>> 3;
                        h ^= h << 10; // xorshift
                        if (h == 0) // initialize hash
                            h = SPINS | (int) t.getId();
                        else if (h < 0 && // approx 50% true
                            (--spins & ((SPINS >>> 1) - 1)) == 0)
                            Thread.yield(); // two yields per wait
                    } else if (U.getObjectVolatile(a, j) != p)
                        // 和slotExchange方法中的类似，arena数组中的数据已被CAS设置
                       // match值还未设置，让其再自旋等待match被设置
                        spins = SPINS; // releaser hasn't set match yet
                    else if (!t.isInterrupted() && m == 0 &&
                        (!timed ||
                            (ns = end - System.nanoTime()) > 0 L)) {
                        // 设置线程t被当前对象阻塞
                        U.putObject(t, BLOCKER, this); // emulate LockSupport
                         // 线程t赋值
                        p.parked = t; // minimize window
                        if (U.getObjectVolatile(a, j) == p)
                            // 数组中对象还相等，表示线程还未被唤醒，唤醒线程
                            U.park(false, ns);
                        p.parked = null;
                         // 设置线程t未被任何对象阻塞
                        U.putObject(t, BLOCKER, null);
                    } else if (U.getObjectVolatile(a, j) == p &&
                        U.compareAndSwapObject(a, j, p, null)) {
                        // 这里给bound增加加一个SEQ
                        if (m != 0) // try to shrink
                            U.compareAndSwapInt(this, BOUND, b, b + SEQ - 1);
                        p.item = null;
                        p.hash = h;
                        i = p.index >>>= 1; // descend
                        if (Thread.interrupted())
                            return null;
                        if (timed && m == 0 && ns <= 0 L)
                            return TIMED_OUT;
                        break; // expired; restart
                    }
                }
            } else
                // 交换失败，表示有其它线程更改了arena数组中下标i的元素
                p.item = null; // clear offer
        } else {
            // 此时表示下标不在bound & MMASK或q不为null但CAS操作失败
           // 需要更新bound变化后的值
            if (p.bound != b) { // stale; reset
                p.bound = b;
                p.collides = 0;
                // 反向遍历
                i = (i != m || m == 0) ? m : m - 1;
            } else if ((c = p.collides) < m || m == FULL ||
                !U.compareAndSwapInt(this, BOUND, b, b + SEQ + 1)) {
                 // 记录CAS失败的次数
                p.collides = c + 1;
                // 循环遍历
                i = (i == 0) ? m : i - 1; // cyclically traverse
            } else
                // 此时表示bound值增加了SEQ+1
                i = m + 1; // grow
            // 设置下标
            p.index = i;
        }
    }
}
```

看完上面`slotExchange`方法和`arenaExchange`方法定义，我们可以看出Exchanger工具类的实现还是很复杂的，虽然Exchanger的使用比较简单。