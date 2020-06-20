---
title: Java线程的启动和终止
tags:
  - Java
  - 线程
copyright: true
categories:
  - Java并发编程
translate_title: start-and-stop-of-java-thread
show_title: java-thread-startup-and-termination
special: JUC
original: true
date: 2019-05-11 18:25:22
---

在Java中我们启动线程都是调用Thread类中的start()方法来启动，当线程处理完`run()`方法里面的逻辑后自动终止。但是在调用`start()`方法之前，我们需要先构建一个Thread对象，一般我们都是直接使用Thread类的构造函数来创建一个线程对象，Thread构造函数定义如下：

```java
public Thread() {
    init(null, null, "Thread-" + nextThreadNum(), 0);
}

public Thread(Runnable target) {
    init(null, target, "Thread-" + nextThreadNum(), 0);
}

Thread(Runnable target, AccessControlContext acc) {
    init(null, target, "Thread-" + nextThreadNum(), 0, acc, false);
}

public Thread(ThreadGroup group, Runnable target) {
    init(group, target, "Thread-" + nextThreadNum(), 0);
}

public Thread(String name) {
    init(null, null, name, 0);
}

public Thread(ThreadGroup group, String name) {
    init(group, null, name, 0);
}

public Thread(Runnable target, String name) {
    init(null, target, name, 0);
}

public Thread(ThreadGroup group, Runnable target, String name) {
    init(group, target, name, 0);
}

public Thread(ThreadGroup group, Runnable target, String name,
    long stackSize) {
    init(group, target, name, stackSize);
}
```

我们可以看到在Thread类中定义了这么多的构造函数，但是这些构造函数都是调用`init()`方法来完成Thread对象的构建，`init()`方法定义如下：

```java
private void init(ThreadGroup g, Runnable target, String name,
    long stackSize) {
    init(g, target, name, stackSize, null, true);
}

/**
 * 
 * @param g  线程组
 * @param target   调用run方法的对象
 * @param name    创建新线程的名称
 * @param stackSize   构建新线程所需要的堆栈大小   stackSize的值为0时，表示忽略这个参数
 * @param acc          上下文
 * @param inheritThreadLocals  是否继承thread-locals
 */
private void init(ThreadGroup g, Runnable target, String name,long stackSize, AccessControlContext acc,boolean inheritThreadLocals) {
    if (name == null) {
        throw new NullPointerException("name cannot be null");
    }

    this.name = name;
    //构建线程的父线程就是当前正在运行的线程
    Thread parent = currentThread();
    SecurityManager security = System.getSecurityManager();
    if (g == null) {
        
        if (security != null) {
            g = security.getThreadGroup();
        }

        //如果线程组为空，则尝试用父线程的线程组
        if (g == null) {
            g = parent.getThreadGroup();
        }
    }

    //安全检查
    g.checkAccess();
    if (security != null) {
        if (isCCLOverridden(getClass())) {
            security.checkPermission(SUBCLASS_IMPLEMENTATION_PERMISSION);
        }
    }

    // 增加线程组中未启动线程的数量
    g.addUnstarted();

    this.group = g;
    //继承父线程的Daemon属性
    this.daemon = parent.isDaemon();
    //继承父线程的优先级
    this.priority = parent.getPriority();
    //构建合适的类加载器
    if (security == null || isCCLOverridden(parent.getClass()))
        this.contextClassLoader = parent.getContextClassLoader();
    else
        this.contextClassLoader = parent.contextClassLoader;
    this.inheritedAccessControlContext =
        acc != null ? acc : AccessController.getContext();
    this.target = target;
    setPriority(priority);
    if (inheritThreadLocals && parent.inheritableThreadLocals != null)
        this.inheritableThreadLocals =
        ThreadLocal.createInheritedMap(parent.inheritableThreadLocals);
    this.stackSize = stackSize;

    //给新线程分配一个ID
    tid = nextThreadID();
}
```

从init方法中我们看到，线程daemon属性、线程的优先级、资源加载的contextClassLoader以及可继承的ThreadLocal都是继承自父线程。从这里也也验证了前面文章中提到的线程优先级的继承性。在init()方法执行完毕后，一个线程对象就被构建出来了，它存放在堆内存中等待调用start()方法启动。start()方法在Thread类中的定义如下：

```java
public synchronized void start() {
   // 构建线程threadStatus默认值为0
    if (threadStatus != 0)
        throw new IllegalThreadStateException();
    /**
     * 通知线程组，该线程即将开始启动，将该现场添加到线程组中
     */
    group.add(this);

    boolean started = false;
    try {
        start0();
        started = true;
    } finally {
        try {
            if (!started) {
                //启动线程失败，将该线程从线程组中移除
                group.threadStartFailed(this);
            }
        } catch (Throwable ignore) {
           
        }
    }
}

private native void start0();

void add(Thread t) {
    synchronized(this) {
        // 如果线程已经销毁，则抛出异常
        if (destroyed) {
            throw new IllegalThreadStateException();
        }
        // 线程组为空，初始化线程组
        if (threads == null) {
            threads = new Thread[4];
        } else if (nthreads == threads.length) {
            //线程组已经满，则扩容，扩容的大小为原来的2倍
            threads = Arrays.copyOf(threads, nthreads * 2);
        }
        // 将线程添加到线程组中
        threads[nthreads] = t;

        // 启动线程数量加一
        nthreads++;

        //为启动的线程数量减一
        nUnstartedThreads--;
    }
}

void threadStartFailed(Thread t) {
    synchronized(this) {
        remove(t);
        nUnstartedThreads++;
    }
}

private void remove(Thread t) {
    synchronized(this) {
        if (destroyed) {
            return;
        }
        for (int i = 0; i < nthreads; i++) {
            if (threads[i] == t) {
                System.arraycopy(threads, i + 1, threads, i, --nthreads - i);
                threads[nthreads] = null;
                break;
            }
        }
    }
}
```

从上面源码中，我们可以看出start()方法最终是调用本地方法start0()方法启动线程的。那么start0()这个本地方法具体做了那些事情呢，它主要完成了将Thread在虚拟机中启动，执行构建Thread对象时重写的run()方法，修改threadStatus的值。
从上面start()方法的源码中可以看到，start()方法是不能被重复调用的，当重复调用start()方法时，会抛出IllegalThreadStateException异常。说完了线程的启动，我们再来说说线程的终止。

### 线程终止

我们在看Thread类的源码的时候，发现Thread类提供了stop()、suspend()和resume()方法来管理线程终止，暂停和恢复。但是这些方法在Thread类中被标记为废弃的方法，不推荐开发者使用这些方法。至于原因，小伙伴自己去查阅资料，这里LZ就不在赘述了。既然官方不推荐是用这么方法来终止线程，那我们应该应该用什么来代替呢？
stop()方法的替代方案是在线程对象的run方法中循环监视一个变量，这样我们就可以很优雅的终止线程。

```java
public class ThreadOne extends Thread {

    private volatile boolean flag = true;

    @Override
    public void run() {

        while (flag) {
            System.out.println(System.currentTimeMillis() / 1000 + " 线程正在运行");
            try {
                TimeUnit.SECONDS.sleep(1);
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
        }

    }


    public static void main(String[] args) throws InterruptedException {

        ThreadOne t = new ThreadOne();
        t.start();
        TimeUnit.SECONDS.sleep(5);
        t.flag = false;

    }
}
output:
1554371306 线程正在运行
1554371307 线程正在运行
1554371308 线程正在运行
1554371309 线程正在运行
1554371310 线程正在运行
```

从上面的示例中，我们可以看到线程在运行了5秒中后，自动关闭了。这是因为主线程在睡眠了5秒后，给ThreadOne类中的flag值赋予了false值。

suspend()和resume()方法的替代方案是使用等待/通知机制。等待/通知的方法是定义在Object类上面的，因此任何类都能实现等待/通知。等待/通知方法定义如下：

```java
// 通知一个在对象上等待的线程，使其从wait()方法返回，而从wait()方法返回的前提是需要获取锁
public final native void notify();
// 通知所有对象上等待的线程，
public final native void notifyAll();
// 超时等待，线程在对象上等待timeout毫秒，如果时间超过则直接返回
public final native void wait(long timeout) throws InterruptedException;
// 超时等待，超时等待的时间可以控制到纳秒
public final void wait(long timeout, int nanos) throws InterruptedException
// 线程在对象上等待，直到有其它的线程调用了notify()或者notifyAll()方法
public final void wait() throws InterruptedException {
    wait(0);
}
```

等待/通知示例如下：

```java
public class NotifyAndWait {

    public static void main(String[] args) {
        Object lock = new Object();
        WaitThread waitThread = new WaitThread(lock, "WaitThread");
        waitThread.start();

        NotifyThread notifyThread = new NotifyThread(lock, "NotifyThread");
        notifyThread.start();
    }
}

class WaitThread extends Thread {
    private Object lock;

    public WaitThread(Object lock, String name) {
        super(name);
        this.lock = lock;
    }
    @Override
    public void run() {
        synchronized(lock) {
            System.out.println(Thread.currentThread().getName() + "开始运行...");
            try {
                lock.wait();
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
            System.out.println(Thread.currentThread().getName() + "执行完成...");
        }
    }
}

class NotifyThread extends Thread {
    private Object lock;

    public NotifyThread(Object lock, String name) {
        super(name);
        this.lock = lock;
    }
    @Override
    public void run() {
        synchronized(lock) {
            System.out.println(Thread.currentThread().getName() + "开始运行...");
            lock.notify();
            System.out.println(Thread.currentThread().getName() + "执行完成...");
        }
    }
}
output:
WaitThread开始运行...
NotifyThread开始运行...
NotifyThread执行完成...
WaitThread执行完成...
```

从上面的示例代码中我们看到，当WaitThread线程调用start()方法并执行完了wait()方法后，将释放锁，然后NotifyThread获取到了锁，当通知线程执行了notify()方法后，将会通知等待在该锁上面的线程，当NotifyThread线程运行完成后，WaitThread线程将会重新恢复执行。
调用wait()方法和notify()方法需要注意一下几点：

- 调用wait()或notify()方法之前需要获取到锁。
- 当调用wait()方法后，线程会立即释放锁。
- 当调用wait()方法后，线程将从运行状态转变为WAITING状态，线程进入等待队列中。
- 当调用notify()/notifyAll()方法后，线程不会立即释放锁，它必须在线程执行完后释放锁，wait线程才能获取到锁再次执行。
