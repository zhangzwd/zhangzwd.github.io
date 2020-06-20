---
title: JUC阻塞队列之SynchronousQueue-非公平模式源码分析
tags:
  - Java
  - 线程
  - SynchronousQueue
copyright: true
categories:
  - Java并发编程
special: JUC
original: true
show_title: juc-synchronousQueue-nofair
translate_title: source-code-analysis-of-synchronousqueue-unfair-mode-of-juc-blocking-queue
date: 2019-10-31 16:29:08
---

上一章LZ分析了[SynchronousQueue的公平模式](https://www.zzwzdx.cn/juc-synchronousQueue-fair/)，这一章将分析SynchronousQueue的非公平模式的数据交换。SynchronousQueue的非公平模式的实现策略是基于TransferStack类的。TransferStack类中的三种状态非常重要，分别如下：

```java
/** 节点代表未实现的消费者 */
static final int REQUEST = 0;
/** 节点代表未完成的生产者 */
static final int DATA = 1;
/** 节点正在执行另一个未完成的数据或请求 */
static final int FULFILLING = 2;
```

其中REQUEST代表的数据请求的操作也就是take操作，而DATA表示的是数据也就是Put操作将数据存放到栈中，用于消费者进行获取操作，而FULFILLING代表的是可以进行互补操作的状态，其实和前面讲的公平模式也很类似。

下面我们来看看非公平模式的`put`和`take`操作。其定义如下：

```java
public void put(E e) throws InterruptedException {
    if (e == null) throw new NullPointerException();
    if (transferer.transfer(e, false, 0) == null) {
        Thread.interrupted();
        throw new InterruptedException();
    }
}

public E take() throws InterruptedException {
    E e = transferer.transfer(null, false, 0);
    if (e != null)
        return e;
    Thread.interrupted();
    throw new InterruptedException();
}
```

从上面源码中我们可以看到`put`和`take`操作都是调用`TransferStack`类中的`transfer`方法，其定义如下：

```java
E transfer(E e, boolean timed, long nanos) {
    SNode s = null; 
    //判断mode
    int mode = (e == null) ? REQUEST : DATA;
    //死循环
    for (;;) {
        SNode h = head;
        //栈顶指针为空或者是模式相同，则进入if语句
        if (h == null || h.mode == mode) { 
            // 指定了timed并且时间小于等于0则取消操作。
            if (timed && nanos <= 0) { 
                //栈顶指针不为空，且节点的删除标志位true，则执行casHead操作
                if (h != null && h.isCancelled())
                    // 弹出删除的节点
                    casHead(h, h.next); 
                else
                    return null;
            //初始化节点并尝试修改栈顶指针    
            } else if (casHead(h, s = snode(s, e, h, mode))) {
                //等待
                SNode m = awaitFulfill(s, timed, nanos);
                //如果返回的节点和自身相等，表示节点被清除
                if (m == s) { 
                    clean(s);
                    return null;
                }
                if ((h = head) != null && h.next == s)
                    casHead(h, s.next); 
                return (E)((mode == REQUEST) ? m.item : s.item);
            }
        // 判断栈顶节点mode不是FULFILLING
        } else if (!isFulfilling(h.mode)) { 
            //如果栈顶指针的删除标识为true，则删除栈顶指针并重定义head节点
            if (h.isCancelled()) 
                casHead(h, h.next); 
            //新建一个Full节点压入栈顶
            else if (casHead(h, s = snode(s, e, h, FULFILLING | mode))) {
                for (;;) { // 循环直到匹配
                     // s的下一个节点
                    SNode m = s.next;
                    //m==null，表示没有等待的内容
                    if (m == null) { 
                        casHead(s, null); // 弹出full节点
                        s = null; 
                        break; // 退到主循环中
                    }
                    SNode mn = m.next;
                    if (m.tryMatch(s)) {
                        casHead(s, mn); // 弹出s和m节点
                        return (E)((mode == REQUEST) ? m.item : s.item);
                    } else // 没有匹配到
                        s.casNext(m, mn); 
                }
            }
        //如果栈顶节点的mode是FULFILLING，则表示有线程正在匹配，则先帮助匹配在循环    
        } else {
            SNode m = h.next; 
            if (m == null) 
                casHead(h, null); 
            else {
                SNode mn = m.next;
                if (m.tryMatch(h)) 
                    casHead(h, mn); 
                else 
                    h.casNext(m, mn); 
            }
        }
    }
}
```

上面`transfer`方法的主要逻辑如下：

1. 如果栈顶节点是否为空，或者栈顶节点的mode和新节点的mode一直，则压栈等待匹配，
2. 如果栈顶节点不为空，且栈顶节点的mode和新节点的mode不一致，则判断栈顶节点的mode是否是`FULFILLING`，如果不是，则进行匹配操作。如果是，则表示已有线程正在进行匹配操作，先帮助线程完成匹配操作，在开始循环。

为了更好的理解上面源码，我们用示图例来详细解释上面源码逻辑。示例如下：

```java
public class TestSynchronousQueue {
    public static void main(String[] args) throws InterruptedException {
        SynchronousQueue<Integer> queue = new SynchronousQueue<>();
        new Thread(()->{
            try {
                queue.put(1);
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
        }).start();

        Thread.sleep(50000);
        new Thread(()->{
            try {
                queue.take();
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
        }).start();

    }
}
```

上面示例中我们先做了一次`put`操作，然后睡眠50秒后，执行了一次`take`操作。在执行`put`操作时，会掉用`transfer`方法，进入`transfer`后计算mode的值，如下所示：

```java
SNode s = null; // constructed/reused as needed
int mode = (e == null) ? REQUEST : DATA;
```

通过上面代码，我们可以知道`e=1!=null`，所以mode是`DATA`类型，接下来会对栈顶节点和mode进行判断，执行如下if语句：

```java
SNode h = head;
if (h == null || h.mode == mode)
```

此时栈顶节点h == null，因此会进入当前的if语句，执行内部逻辑，代码如下：

```java
if (timed && nanos <= 0) {      // can't wait
    if (h != null && h.isCancelled())
        casHead(h, h.next);     // pop cancelled node
    else
        return null;
} else if (casHead(h, s = snode(s, e, h, mode))) {
    SNode m = awaitFulfill(s, timed, nanos);
    if (m == s) {               // wait was cancelled
        clean(s);
        return null;
    }
    if ((h = head) != null && h.next == s)
        casHead(h, s.next);     // help s's fulfiller
    return (E) ((mode == REQUEST) ? m.item : s.item);
}
```

上面代码中为判断timed和nanos, 如果指定了timed并且nanos小于0，则判断栈顶节点不为null并且栈顶节点已经删除，则弹出栈顶节点重新定义栈顶节点，否则返回null。上述条件在当前例子中都不满足，所以要进入到下面这段代码中，首先进行对s进行初始化值，并且进行入栈操作，`casHead(h, s = snode(s, e, h, mode))`，下面看一下栈中的情况如下图所示： 
![](http://cdn.zzwzdx.cn/blog/put_2_1.png&blog)

当执行完入栈操作后，接下来会执行`awaitFulfill`操作，我们先来看看该方法源码：

```java
SNode awaitFulfill(SNode s, boolean timed, long nanos) {
    //如果指定了timed，则计算线程睡眠终止时间
    final long deadline = timed ? System.nanoTime() + nanos : 0L;
    //当前线程
    Thread w = Thread.currentThread();
    //自旋次数
    int spins = (shouldSpin(s) ? (timed ? maxTimedSpins : maxUntimedSpins) : 0);
    //死循环
    for (;;) {
        //如果线程中断，则清除节点
        if (w.isInterrupted())
            //清除节点
            s.tryCancel();
        //s节点的匹配节点
        SNode m = s.match;
        //如果匹配节点存在，则返回
        if (m != null)
            return m;
        // 如果指定了timed=true,则重新计算线程睡眠时间
        if (timed) {
            nanos = deadline - System.nanoTime();
            //超时，清理节点
            if (nanos <= 0L) {
                s.tryCancel();
                continue;
            }
        }
        //计算自旋次数
        if (spins > 0)
            spins = shouldSpin(s) ? (spins-1) : 0;
        else if (s.waiter == null)
            s.waiter = w; 
        else if (!timed)
            LockSupport.park(this); //阻塞线程
        else if (nanos > spinForTimeoutThreshold)
            LockSupport.parkNanos(this, nanos);
    }
}
```

上面`awaitFulfill`方法的逻辑比较清晰，首先判断线程是否中断，如果中断则将节点清除。然后判断节点是否已经匹配，如果已经匹配，则返回匹配的节点，否则判断节点是否需要自旋，判断的方法为`shouldSpin(s)`,如果需要自旋，则先自旋，如果不需要自旋或者在自旋次数完毕后，节点还没有被匹配或者中断，则阻塞当前线程。判断是否需要自旋源码如下：

```java
boolean shouldSpin(SNode s) {
    //栈顶指针
    SNode h = head;
    //如果带匹配的节点就是栈顶节点 或者 栈顶节点为null  或者站点节点的mode是FULFILLING，则需要自旋
    return (h == s || h == null || isFulfilling(h.mode));
}
```
再回到我们的示例中，在执行完`awaitFulfill`方法后，栈中的情况如下：

![](http://cdn.zzwzdx.cn/blog/put2_2.png&blog)

在示例中，主线程在Thread_1启动后，睡眠了50秒，因此此时Thread_1线程将进入阻塞状态，即调用`queue.put(1);`方法的线程进入阻塞状态，在过了50秒后，Thread_2线程(即调用`queue.take()`方法的线程)启动，该线程将调用`E e = transferer.transfer(null, false, 0)`,进入`transfer`方法后，任然会新进行mode值的计算，会执行下面代码

```java
SNode s = null; // constructed/reused as needed
int mode = (e == null) ? REQUEST : DATA;
```

此时根据示例我们知道e=null，因此mode=REQUEST。继续往下执行，会进入第二个if语句，即执行下面代码

```java
else if (!isFulfilling(h.mode)) { // 条件二
    if (h.isCancelled())            // already cancelled
        casHead(h, h.next);         // pop and retry
    else if (casHead(h, s=snode(s, e, h, FULFILLING|mode))) {
        for (;;) { // loop until matched or waiters disappear
            SNode m = s.next;       // m is s's match
            if (m == null) {        // all waiters are gone
                casHead(s, null);   // pop fulfill node
                s = null;           // use new node next time
                break;              // restart main loop
            }
            SNode mn = m.next;
            if (m.tryMatch(s)) {
                casHead(s, mn);     // pop both s and m
                return (E) ((mode == REQUEST) ? m.item : s.item);
            } else                  // lost match
                s.casNext(m, mn);   // help unlink
        }
    }
}
```

进入if语句后，首先判断栈顶节点是否被清除，很明显此时栈顶节点没有被删除，因此执行`casHead(h, s=snode(s, e, h, FULFILLING|mode))`,在执行该语句后，栈中的情况如下：

![](http://cdn.zzwzdx.cn/blog/take_2_1.png&blog)

继续往后面执行代码，执行完`SNode m = s.next;  `后，从上图中知道，m=Reference-1!=null,继续执行后面代码`SNode mn = m.next`,此时mn=null,然后执行`m.tryMatch(s)`,如果成功，则表示匹配成功，将s节点和m节点从栈中弹出，然后返回。如果匹配不成功，则更新s节点的next,重新循环。在上面执行的代码中核心方法就是`tryMatch`方法，我们来看看该方法的源码。

```java
boolean tryMatch(SNode s) {
    if (match == null &&
        UNSAFE.compareAndSwapObject(this, matchOffset, null, s)) {
        Thread w = waiter;
        if (w != null) {    // waiters need at most one unpark
            waiter = null;
            LockSupport.unpark(w);
        }
        return true;
    }
    return match == s;
}
```

tryMatch方法逻辑比较简单，利用CAS更新m节点的match字段为s节点，如果更新成功，则唤醒m节点中的额waiter线程。到此SynchronousQueue的给公平模式就分析完成了，但是细心的朋友会发现，最后面还有一个帮助fulfill的操作，（transfer中）代码如下所示： 

```java
SNode m = h.next;               // m is h's match
if (m == null)                  // waiter is gone
    casHead(h, null);           // pop fulfilling node
else {
    SNode mn = m.next;
    if (m.tryMatch(h))          // help match
        casHead(h, mn);         // pop both h and m
    else                        // lost match
        h.casNext(m, mn);       // help unlink
}
```

从上面的分析图中，我们可以得知在take操作时，栈顶节点的mode=FULFILLING,我们设想下当一个线程正在做take操作时，另一个线程B也来进行take操作，这样线程会运行上面的fulfill操作代码块。此时线程B会先帮助上一个take操作的线程完成，然后在进行自己的操作。

 最后我们来看看clean方法，消的clean方法内容: 

```java
void clean(SNode s) {
    s.item = null;   // 将item值设置为null
    s.waiter = null; // 将线程设置为null
    SNode past = s.next; // s节点下一个节点如果不为空，并且节点是取消节点则指向下下个节点，这里是结束的标识，代表没有了。
    if (past != null && past.isCancelled())
        past = past.next;
    // 如果取消的是头节点则运行下面的清理操作，操作逻辑很简单就是判断头结点是不是取消节点，如果是则将节点一定到下一个节点
    SNode p;
    while ((p = head) != null && p != past && p.isCancelled())
        casHead(p, p.next);
    // 取消不是头结点的嵌套节点。
    while (p != null && p != past) {
        SNode n = p.next;
        if (n != null && n.isCancelled())
            p.casNext(n, n.next);
        else
            p = n;
    }
}
```

 通过源码可以看到首先是先找到一个可以结束的标识past，也就说到这里就结束了，判断是否不是头节点被取消了，如果是头节点被取消了则进行第一个while语句，操作也很简单就是将头节点替换头结点的下一个节点，之后进行下面的while语句操作，其实就是将取消的上一个节点的下一个节点指定为被取消节点的下一个节点，到此分析完毕了。 

如果有分析不正确的地方，请给位指正。
