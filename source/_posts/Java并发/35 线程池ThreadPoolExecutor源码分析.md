---
title: 线程池ThreadPoolExecutor源码分析
tags:
  - Java
  - 线程池
copyright: true
categories:
  - Java并发编程
special: JUC
original: true
translate_title: source-code-analysis-of-threadpoolexecutor-for-thread-pool
date: 2020-05-09 14:12:57
show_title: thread-pool
---

### 什么是线程池

创建线程要花费昂贵的资源和时间，如果任务来了才创建那么响应时间会变长，而且一个进程能创建的线程数量有限。为了避免这些问题，在程序启动的时候就创建若干线程来响应出来，它们被称为线程池，里面的线程就叫做工作线程。

### 线程池的优点

*   避免线程的创建和销毁带来的性能开销。
*   避免大量的线程间因互相抢占系统资源导致的阻塞现象。
*   能够对线程进行简单的管理并提供定时执行、间隔执行等功能。

### 线程池工作原理

我们在创建线程池后，线程池是如何来执行任务的呢？下面我们就来看看线程池的主要处理流程。

![线程池处理流程](http://cdn.zzwzdx.cn/blog/image-20200326221736249.png&blog)

从上面的图我们可以看到ThreadPoolExecutor提供了2种方式提交任务，这个2种方法提交任务的区别，我们后面会说到。当提交一个新任务到线程池时，其处理流程如下：

1.  线程池判断核心线程池里的线程是否都在执行任务，如果不是，则创建一个新的工作线程来执行任务，如果核心线程池中的线程都在执行任务，则进入下一个流程。
2.  线程池判断工作队列是否已满，如果工作队列没有满，则将任务存储到工作队列中。如果工作队列已满，则进入下一个流程。
3.  线程池判断线程池的线程是否都在执行任务，如果不是，则创建一个工作线程来来执行任务，如果是，则交给创建线程池时的拒绝策略来处理任务。

### 源码分析

上面线程池的流程分析让我们很直观的了解了`ThreadPoolExecutor`的工作原理，下面我们通过源码来具体分析线程池是如何实现的。

#### ThreadPoolExecutor类图

在研究源码之前，我们先大体的认识下ThreadPoolExecutor的整个架构。

![ThreadPoolExecutor类图](http://cdn.zzwzdx.cn/blog/ThreadPoolExecutor类图.png&blog)

上面是ThreadPoolExecutor的UML类图，上面类中的方法和属性并没有完全列出来，只是将主要的属性和方法列出。

#### 线程池状态

线程池状态定义如下：

```java
private final AtomicInteger ctl = new AtomicInteger(ctlOf(RUNNING, 0));
private static final int COUNT_BITS = Integer.SIZE - 3;
private static final int CAPACITY   = (1 << COUNT_BITS) - 1;

// runState is stored in the high-order bits
private static final int RUNNING    = -1 << COUNT_BITS;
private static final int SHUTDOWN   =  0 << COUNT_BITS;
private static final int STOP       =  1 << COUNT_BITS;
private static final int TIDYING    =  2 << COUNT_BITS;
private static final int TERMINATED =  3 << COUNT_BITS;

// Packing and unpacking ctl
private static int runStateOf(int c)     { return c & ~CAPACITY; }
private static int workerCountOf(int c)  { return c & CAPACITY; }
private static int ctlOf(int rs, int wc) { return rs | wc; }
```

其中AtomicInteger变量ctl的功能非常强大：利用低29位表示线程池中线程数，通过高3位表示线程池的运行状态：

1.  RUNNING：-1 << COUNT_BITS，即高3位为111，该状态的线程池会接收新任务，并处理阻塞队列中的任务
2.  SHUTDOWN： 0 << COUNT_BITS，即高3位为000，该状态的线程池不会接收新任务，但会处理阻塞队列中的任务；
3.  STOP ： 1 << COUNT_BITS，即高3位为001，该状态的线程不会接收新任务，也不会处理阻塞队列中的任务，而且会中断正在运行的任务；
4.  TIDYING ： 2 << COUNT_BITS，即高3位为010, 所有的任务都已经终止；
5.  TERMINATED： 3 << COUNT_BITS，即高3位为011, terminated()方法已经执行完成

#### 构造函数

第一步，我们先从`ThreadPoolExecutor`的构造函数，来了解`ThreadPoolExecutor`是如何创建的。其构造函数源码如下：

```java
public ThreadPoolExecutor(int corePoolSize,
                          int maximumPoolSize,
                          long keepAliveTime,
                          TimeUnit unit,
                          BlockingQueue<Runnable> workQueue,
                          ThreadFactory threadFactory,
                          RejectedExecutionHandler handler) {
    //参数检测
    if (corePoolSize < 0 || maximumPoolSize <= 0 || maximumPoolSize < corePoolSize ||
            keepAliveTime < 0)
        throw new IllegalArgumentException();
    if (workQueue == null || threadFactory == null || handler == null)
        throw new NullPointerException();
    //安全管理器
    this.acc = System.getSecurityManager() == null ?
               null :
               AccessController.getContext();
    //赋值
    this.corePoolSize = corePoolSize;
    this.maximumPoolSize = maximumPoolSize;
    this.workQueue = workQueue;
    this.keepAliveTime = unit.toNanos(keepAliveTime);
    this.threadFactory = threadFactory;
    this.handler = handler;
}
```

`ThreadPoolExecutor` 的构造其实非常的简单，就是将传入参数赋值给成员变量，下面我们来解释下构造函数中各个参数所代表的意思。

1.  `corePoolSize:`  线程池的核心线程数量。线程池的核心线程数量在我们创建线程池时默认是不会改变的，即使线程池没有处理任何任务，它的数量也是不会改变的。除非我们手动的设置了`ThreadPoolExecutor`中`allowCoreThreadTimeOut`的值为true,那么空闲的核心线程将会被销毁。

2.  `maximumPoolSize:`  线程池最大线程数量。

3.  `keepAliveTime:` 线程存活时间，当线程池中线程数大于核心线程数时，线程的空闲时间如果超过线程存活时间，那么这个线程就会被销毁，直到线程池中的线程数小于等于核心线程数。

4.  `unit:` 超时时间单位

5.  `workQueue:` 工作队列，用于存储任务

6.  `threadFactory:` 线程工厂，用户创建线程，threadFactory创建的线程也是采用new Thread()方式。

7.  `handler:` 拒绝策略，当线程池和阻塞队列都满时，再加入的任务会执行此策略。

    在JDK1.5中Java线程池提供了以下几种拒绝策略

    *   AbortPolicy：直接抛出异常。
    *   CallerRunsPolicy：只用调用者所在线程来运行任务。
    *   DiscardOldestPolicy：丢弃队列里最近的一个任务，并执行当前任务。
    *   DiscardPolicy：不处理，丢弃掉。

    当然，我们也可以根据应用场景需要自己来实现RejectedExecutionHandler接口自定义策略。如记录
    日志或持久化存储不能处理的任务。

ThreadPoolExecutor虽然还提供了一些其它的构造函数，但是它们最终都是调用上面的构造函数来完成线程池的创建的。

#### execute提交任务

execute提交任务源码如下：

```java
public void execute(Runnable command) {
    //参数检测
    if (command == null)
        throw new NullPointerException();
    //获取线程池的控制状态，它是一个原子变量，包括了高3位的运行状态和低29位的有效线程数量
    int c = ctl.get();
    //判断线程池中的线程数是否小于核心线程数量
    //小于，则直接创建工作线程执行任务,否则进入下一步
    if (workerCountOf(c) < corePoolSize) {
        //如果添加工作线程成功，则直接返回，否则再次获取线程池控制状态，并进入下一步
        if (addWorker(command, true))
            return;
        //重新获取线程池控制状态
        c = ctl.get();
    }
    //如果线程池处于运行状态且阻塞队列可以添加任务，则进入if语句否则进入下一步 ②
    if (isRunning(c) && workQueue.offer(command)) {
        /*
        * 再次获取线程池控制状态
        * 这里再次获取线程池控制状态，是因为在执行if语句时，线程池控制状态可能已经改变
        */
        int recheck = ctl.get();
		// 如果线程池处于非运行状态且任务可以从队列中删除(即该任务已经存在于工作队列中)，
        // 则调用初始化线程池的拒绝策略
        if (! isRunning(recheck) && remove(command))
            reject(command);
        //如果线程池中的线程数量为0，则调用addWorker执行任务
        else if (workerCountOf(recheck) == 0)
            addWorker(null, false);
    } else if (!addWorker(command, false))
        //如果addWorker失败，则执行拒绝策略
        reject(command);
}
```

`execute`逻辑比较简单，就是更具线程池的控制状态已经工作队列是否已满的情况调用`addWorker`方法创建线程并执行任务或者调用拒绝策略处理任务。在上面源码的第②步中为什么需要double check线程池的状态？这是因为在多线程环境下，线程池的状态时刻在变化，而ctl.get()是非原子操作，很有可能刚获取了线程池状态后线程池状态就改变了。判断是否将command加入workque是线程池之前的状态。倘若没有double check，万一线程池处于非running状态（在多线程环境下很有可能发生），那么command永远不会执行。

####  addWorker方法

从上面execute方法的源码可以看出，addWorker主要是负责创建新的线程并执行任务，其源码定义如下：

```java
private boolean addWorker(Runnable firstTask, boolean core) {
    retry:
    //死循环
    for (;;) {
        //获取线程池的控制状态
        int c = ctl.get();
        //根据线程池的控制状态获取线程池的运行状态
        int rs = runStateOf(c);

        //(1) 如果线程池已经停止或者关闭，直接返回false
        if (rs >= SHUTDOWN && ! (rs == SHUTDOWN && firstTask == null &&
               ! workQueue.isEmpty()))
            return false;
		//(2) 通过cas增加线程个数
        for (;;) {
            //（2.1）获取线程池中种的线程数量
            int wc = workerCountOf(c);
            //（2.2）如果线程数量超过限制，则直接返回false
            if (wc >= CAPACITY ||
                wc >= (core ? corePoolSize : maximumPoolSize))
                return false;
            //（2.3）cas增加线程线程个数，成功则直接跳出最外层的for循环
            if (compareAndIncrementWorkerCount(c))
                break retry;
            //（2.4）cas 失败重新获取线程池控制状态
            c = ctl.get();
          	//（2.5）看线程池状态是否变化了，变化则跳到外层循环重试重新获取线程池状态，否者内层循环重新cas。
            if (runStateOf(c) != rs)
                continue retry;
        }
    }

    boolean workerStarted = false;
    boolean workerAdded = false;
    Worker w = null;
    try {
        //（3）创建worker
        w = new Worker(firstTask);
        final Thread t = w.thread;
        if (t != null) {
            final ReentrantLock mainLock = this.mainLock;
            //（3.1）加锁，确保worker添加成功，因为可能多个线程调用了线程池的execute方法。
            mainLock.lock();
            try {
                //（3.2）重新检查线程池状态，为了避免在获取锁前调用了shutdown接口
                int rs = runStateOf(ctl.get());

                if (rs < SHUTDOWN ||
                    (rs == SHUTDOWN && firstTask == null)) {
                    if (t.isAlive()) 
                        throw new IllegalThreadStateException();
                    //（3.3）添加worker
                    workers.add(w);
                    int s = workers.size();
                    if (s > largestPoolSize)
                        largestPoolSize = s;
                    workerAdded = true;
                }
            } finally {
                mainLock.unlock();
            }
            //（3.4）添加成功则启动任务
            if (workerAdded) {
                t.start();
                workerStarted = true;
            }
        }
    } finally {
        if (! workerStarted)
            addWorkerFailed(w);
    }
    return workerStarted;
}
```

如上代码主要分两部分，第一部分的双重循环目的是通过 cas 操作增加线程池线程数，第二部分主要是并发安全的把任务添加到 workers 里面，并且启动任务执行。

先看第一部分的代码（1)，如下所示:

```java
if (rs >= SHUTDOWN &&
    ! (rs == SHUTDOWN &&
       firstTask == null &&
       ! workQueue.isEmpty()))
    return false;

```

这样看不好理解，我们展开！运算符后，相当于：

```java
s >= SHUTDOWN &&
    (rs != SHUTDOWN ||    
     firstTask != null || 
     workQueue.isEmpty()) 
```

如上代码，也就是说代码（1）在下面几种情况下会返回 false：

  1.当前线程池状态为 STOP，TIDYING，TERMINATED；

  2.当前线程池状态为 SHUTDOWN 并且已经有了第一个任务；

  3.当前线程池状态为 SHUTDOWN 并且任务队列为空。

我们再回到addWorker方法，看到代码（2），我们发现内层循环是通过CAS方式增加线程数量，代码（2.2）判断线程数量是否超过限制，超过了则直接返回false，否则执行代码（2.3）利用CAS增加线程个数，如果成功，则跳出外层循环，执行第二部分，如果失败则判断线程池状态是否发生了改变，如果改变则重新进入外层循环，如果没有发生改变则从内层开始继续通过CAS增加线程数量。

执行到第二部分的代码（3），说明使用CAS成功的增加了线程个数，但现在仅仅是线程的数量增加了并没有创建一个新的线程来执行任务，第二部分代码主要实现的就是增加一个工作线程,并将其添加到工作队列中，最后启动线程。

#### 工作线程Wokder

在addWorker方法中，新增工作线程是通过new Worker来实现的，我们先来看看Worker这个类的定义。

```java
private final class Worker  extends AbstractQueuedSynchronizer implements Runnable
{
    Worker(Runnable firstTask) {
        //设置状态
        setState(-1); 
        //外部提交的任务
        this.firstTask = firstTask;
        //创建线程
        this.thread = getThreadFactory().newThread(this);
    }
    public void run() {
        runWorker(this);
    }
    //....省略部分代码
}
```

我们看到Worker是一个Runnable并且是AQS的子类，那么Worker类肯定能够进行并发控制。

在上面addWorker方法中，添加worker成功后，会启动则会执行Worker类中的run方法，实际执行的则是runWorker方法。

##### runWorker

runWorker方法定义如下：

```java
final void runWorker(Worker w) {
    //获取当前线程
    Thread wt = Thread.currentThread();
    // 获取当前worker携带的任务
    Runnable task = w.firstTask;
    w.firstTask = null;
    //修改state为0，将占用锁的线程设为null（第一次执行之前没有线程占用）,运行线程中断
    w.unlock();
    boolean completedAbruptly = true;
    try {
        // 自旋。先执行自己携带的任务，然后从阻塞队列中获取一个任务直到无法获取任务
        while (task != null || (task = getTask()) != null) {
             // 将state修改为1，设置占有锁的线程为自己
            w.lock();
             /**
              * check线程池的状态，如果状态为stop以上(stop以上不执行任务)，则中断当前线程
              * 如果当前线程已被中断（其他线程并发的调用线程池的shutdown()或shutdownNow()方法），则check线程池状态是否为stop以上
              * 最后如果线程池状态为stop以上，当前线程未被中断则中断当前线程
              */
            if ((runStateAtLeast(ctl.get(), STOP) ||
                 (Thread.interrupted() &&
                  runStateAtLeast(ctl.get(), STOP))) &&
                !wt.isInterrupted())
                wt.interrupt();
            try {
                //执行任务前做的事情，留给子类实现
                beforeExecute(wt, task);
                Throwable thrown = null;
                try {
                    //执行外部提交的任务，通过try-catch来保证异常不会影响线程池本身的功能
                    task.run();
                } catch (RuntimeException x) {
                    thrown = x; throw x;
                } catch (Error x) {
                    thrown = x; throw x;
                } catch (Throwable x) {
                    thrown = x; throw new Error(x);
                } finally {
                    //任务执行完成后做的事情，留给子类实现
                    afterExecute(task, thrown);
                }
            } finally {
                task = null;
                //完成任务数量统计
                w.completedTasks++;
                w.unlock();
            }
        }
        completedAbruptly = false;
    } finally {
         /**
          * 从上面可以看出如果实际业务(外部提交的Runnable)出现异常会导致当前worker终止
          * completedAbruptly 此时为true意味着worker是突然完成，不是正常退出
          */
        processWorkerExit(w, completedAbruptly); // 执行worker退出收尾工作
    }
}
```

上面runWorker方法的整个流程如下：

1.  如果当前 task==null 或者调用 getTask 从任务队列获取的任务返回 null，则跳转到代码processWorkerExit。
2.  如果 task 不为 null 则获取工作线程内部持有的独占锁，然后执行扩展接口代码，在具体任务执行前做一些事情，扩展接口执行完成后，执行具体任务，在具体任务执行完毕后做一些事情，最后统计当前 worker 完成了多少个任务，并释放锁。

这里在执行具体任务期间加锁，是为了避免任务运行期间，其他线程调用了 shutdown 或者 shutdownNow 命令关闭了线程池。

##### getTask

```java
private Runnable getTask() {
    boolean timedOut = false; // Did the last poll() time out?
    // 自旋获取任务(因为是多线程环境)
    for (;;) {
        int c = ctl.get();// 读取最新的clt
        int rs = runStateOf(c);
        /**
         * 1、线程池状态为shutdown并且任务队列为空
         * 2、线程池状态为stop状态以上
         * 这2种情况直接减少worker数量，并且返回null从而保证外部获取任务的worker进行正常退出
         */
        if (rs >= SHUTDOWN && (rs >= STOP || workQueue.isEmpty())) {
            decrementWorkerCount();
            return null;
        }
        int wc = workerCountOf(c);
        /**
         * 1、允许核心线程退出
         * 2、当前的线程数量超过核心线程数
         * 这时获取任务的机制切换为poll(keepAliveTime)
         */
        boolean timed = allowCoreThreadTimeOut || wc > corePoolSize;
        /**
         * 1、线程数大于maximumPoolSize(什么时候会出现这种情况？ 当maximumPoolSize初始设置为0或者其他线程通过set方法对其进行修改)
         * 2、线程数未超过maximumPoolSize但是timed为true(允许核心线程退出或者线程数量超过核心线程)
         * 并且上次获取任务超时(没获取到任务,我们推测本次依旧会超时)
         * 3、在满足条件1或者条件2的情况下进行check：运行线程数大于1或者任务队列没有任务
         */
        if ((wc > maximumPoolSize || (timed && timedOut))
            && (wc > 1 || workQueue.isEmpty())) {
            if (compareAndDecrementWorkerCount(c)) // CAS进行worker数量-1，成功则返回null进行worker退出流程，失败则继续自旋
                return null;
            continue;
        }
        try {
            // 如果允许超时退出，则调用poll(keepAliveTime)获取任务，否则则通过tack()一直阻塞等待直到有任务提交到队列
            Runnable r = timed ? workQueue.poll(keepAliveTime, TimeUnit.NANOSECONDS) : workQueue.take();
            if (r != null)
                return r;
            timedOut = true;// 当等待超过keepAliveTime时间未获取到任务时，标记为true。在下次自旋时会进入销毁流程
        } catch (InterruptedException retry) {
            // 什么时候会抛出异常？当调用shutdown或者shutdownNow方法触发worker内的Thread调用interrupt方法时会执行到此处
            timedOut = false;
        }
    }
}
```

从getTask方法中，我们明白了核心线程能够保留的原因，这是因为在获取任务时，如果队列为空并且allowCoreThreadTimeOut为false时，通过workQueue.take()方法将挂起线程。着就保证了线程池在处理完任务后核心线程不会被回收。这是也为什么前面在初始化线程池时传入的是阻塞队列的原因了。

##### processWorkerExit

```java
private void processWorkerExit(Worker w, boolean completedAbruptly) {
    //如果completedAbruptly为ture,则将工作线程数量减一
    //这里completedAbruptly为true是在runWorker执行时异常的情况
    if (completedAbruptly)
        decrementWorkerCount();

    final ReentrantLock mainLock = this.mainLock;
    //加锁
    mainLock.lock();
    try {
        //统计整个线程池完成的任务个数,并从工作集里面删除当前woker
        completedTaskCount += w.completedTasks;
        workers.remove(w);
    } finally {
        mainLock.unlock();
    }
	//尝试设置线程池状态为TERMINATED，如果当前是shutdonw状态并且工作队列为空
    //或者当前是stop状态当前线程池里面没有活动线程
    tryTerminate();
	//如果当前线程个数小于核心个数，则增加
    int c = ctl.get();
    if (runStateLessThan(c, STOP)) {
        if (!completedAbruptly) {
            int min = allowCoreThreadTimeOut ? 0 : corePoolSize;
            if (min == 0 && ! workQueue.isEmpty())
                min = 1;
            if (workerCountOf(c) >= min)
                return; // replacement not needed
        }
        addWorker(null, false);
    }
}
```

processWorkerExit流程总结如下：

1.  判断是否是意外退出的，如果是意外退出的话，那么就需要把WorkerCount--

2.  加完锁后，同步将completedTaskCount进行增加，表示总共完成的任务数，并且从WorkerSet中将对应的Worker移除

3.  调用tryTemiate，进行判断当前的线程池是否处于SHUTDOWN状态，判断是否要终止线程

4.  判断当前的线程池状态，如果当前线程池状态比STOP大的话，就不处理

5.  否则判断是否是意外退出，如果不是意外退出的话，那么就会判断最少要保留的核心线程数，如果allowCoreThreadTimeOut被设置为true的话，那么说明核心线程在设置的KeepAliveTime之后，也会被销毁。

6.  如果最少保留的Worker数为0的话，那么就会判断当前的任务队列是否为空，如果任务队列不为空的话而且线程池没有停止，那么说明至少还需要1个线程继续将任务完成。

7.  判断当前的Worker是否大于min，也就是说当前的Worker总数大于最少需要的Worker数的话，那么就直接返回，因为剩下的Worker会继续从WorkQueue中获取任务执行。

8.  如果当前运行的Worker数比当前所需要的Worker数少的话，那么就会调用addWorker，添加新的Worker，也就是新开启线程继续处理任务。

##### tryTerminate

processWorkerExit方法会尝试调用tryTerminate方法来终止线程池，tryTerminate方法定义如下：

```java
final void tryTerminate() {
    for (;;) {
        //线程池控制状态
        int c = ctl.get();
        //线程池控制状态在一下情况下直接返回
        //1.线程池处于运行状态
        //2.c>=TIDYING,线程池已经停止或者正在停止
        //3.SHUTDOWN状态但是工作队列非空
        if (isRunning(c) ||
            runStateAtLeast(c, TIDYING) ||
            (runStateOf(c) == SHUTDOWN && ! workQueue.isEmpty()))
            return;
        //程序运行到这里说明线程池控制状态为SHUTDOWN，并且工作队列为空
        //如果还存在工作线程，则中断一个空闲worker
        if (workerCountOf(c) != 0) { 
            //中断一个线程，前面在getTaskf方法中已经说了，核心线程在工作队列为空时将挂起，那么打断一个线程后，工作线程将从runWorker中退出，调用processWorkerExit(w, true),达到关闭所有的工作线程然后关闭线程池的目的
            interruptIdleWorkers(ONLY_ONE);
            return;
        }
		//如果没有了工作线程，则 通过CAS，先置为 TIDYING 态，并最终更新为 TERMINATED 态
        final ReentrantLock mainLock = this.mainLock;
        mainLock.lock();
        try {
            if (ctl.compareAndSet(c, ctlOf(TIDYING, 0))) {
                try {
                    terminated();
                } finally {
                    ctl.set(ctlOf(TERMINATED, 0));
                    termination.signalAll();
                }
                return;
            }
        } finally {
            mainLock.unlock();
        }
        // else retry on failed CAS
    }
}
```

##### shutdown

```java
public void shutdown() {
    final ReentrantLock mainLock = this.mainLock;
    mainLock.lock();
    try {
         // 线程安全性检查
        checkShutdownAccess();
        // 更新线程池状态为 SHUTDOWN
        advanceRunState(SHUTDOWN);
         // 尝试关闭空闲线程
        interruptIdleWorkers();
        // 空实现
        onShutdown(); // hook for ScheduledThreadPoolExecutor
    } finally {
        mainLock.unlock();
    }
    // 尝试中止线程池
    tryTerminate();
}
```

每个方法都有特定的目的，其中 `checkShutdownAccess()` 和 `advanceRunState(SHUTDOWN)`比较简单，所以这里不再描述了，而 `interruptIdleWorkers()` 尝试关闭空闲线程这个没什么好说的， `tryTerminate()`方法上面我们已经做了详细的解释，也不在赘述了。

#### submit提交

submit方法是ThreadPoolExecutor另一种提交任务的方式，它的源码如下：

```java
public Future<?> submit(Runnable task) {
    if (task == null) throw new NullPointerException();
    //将Runnable转换成RunnableFuture
    RunnableFuture<Void> ftask = newTaskFor(task, null);
    //调用execut方法
    execute(ftask);
    return ftask;
}
```

这里可以看出submit实际上还是调用的execute方法来提交任务的，只不过submit方式是有返回值的，而execute方式是没有返回值的。

注意：这里的submit方法并不是ThreadPoolExecutor类中的方法，而是AbstractExecutorService类中的方法，AbstractExecutorService是一个抽象类，ThreadPoolExecutor继承了AbstractExecutorService。

### 总结

以上就是ThreadPoolExecutor的工作原理和源码分析，希望能够帮助同学们对ThreadPoolExecutor有一个深入的了解。

