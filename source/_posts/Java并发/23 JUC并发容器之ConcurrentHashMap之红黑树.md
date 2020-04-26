---
title: JUC并发容器之ConcurrentHashMap之红黑树源码分析
tags:
  - Java
  - 并发
  - ConcurrentHashMap
  - 红黑树
copyright: true
categories:
  - Java并发编程
translate_title: >-
  source-code-analysis-of-red-black-tree-of-concurrenthashmap-of-juc-concurrent-container
special: JUC
original: true
show_title: juc-redblacktree
date: 2019-09-25 13:33:38
---

在分析ConcurrentHashMap中有关红黑树的源码之前，我们先要对红黑树进行一定的了解。

## 红黑树介绍

红黑树（Red Black Tree） 是一种自平衡二叉查找树，是在计算机科学中用到的一种数据结构。它是在1972年由Rudolf Bayer发明的，当时被称为平衡二叉B树。后来，在1978年被 Leo J. Guibas 和 Robert Sedgewick 修改为如今的“红黑树”。

红黑树是每个节点都带有颜色属性的二叉查找树，颜色或红色或黑色。在二叉查找树强制一般要求以外，对于任何有效的红黑树我们增加了如下的额外要求:

1. 节点是红色或者黑色
2. 根节点是黑色
3. 每个叶子节点（NIL）都是黑色的空节点**[注意：这里叶子节点，是指为空(NIL或NULL)的叶子节点！]**
4. 每个红色节点的两个子节点都是黑色
5. 从任一节点到其每个叶子的所有路径都包含相同数目的黑色节点

下图就是一颗典型的红黑树

![红黑树结构](http://cdn.zzwzdx.cn/blog/红黑树结构.png&blog)

## 红黑树的旋转

红黑树在删除或者添加节点后都会用到旋转和着色方法，这是因为在添加或者删除红黑树的节点后，红黑树就发生了变化，这就有可能不满足红黑树的5条基本性质了，也就不再是一颗红黑树了。而通过旋转，可以使这颗树重新成为红黑树。简单点说，旋转的目的是让树保持红黑树的特性。

### 左旋

左旋的定义如下：

> 以某个节点作为支点（旋转点）进行左旋，那么该支点的右子节点变为旋转点的父节点，右子节点的左子节点变为旋转点的右子节点，训传点的左子节点保持不变

下图即为左旋操作：

![红黑树左旋](http://cdn.zzwzdx.cn/blog/红黑树左旋.jpg&blog)

左旋的伪代码《算法导论》：参考上面的示意图和下面的伪代码，理解“红黑树T的节点x进行左旋”是如何进行的。

```java
LEFT-ROTATE(T, x)  
 y ← right[x]            // 前提：这里假设x的右孩子为y。下面开始正式操作
 right[x] ← left[y]      // 将 “y的左孩子” 设为 “x的右孩子”，即 将β设为x的右孩子
 p[left[y]] ← x          // 将 “x” 设为 “y的左孩子的父亲”，即 将β的父亲设为x
 p[y] ← p[x]             // 将 “x的父亲” 设为 “y的父亲”
 if p[x] = nil[T]       
 then root[T] ← y                 // 情况1：如果 “x的父亲” 是空节点，则将y设为根节点
 else if x = left[p[x]]  
           then left[p[x]] ← y    // 情况2：如果 x是它父节点的左孩子，则将y设为“x的父节点的左孩子”
           else right[p[x]] ← y   // 情况3：(x是它父节点的右孩子) 将y设为“x的父节点的右孩子”
 left[y] ← x             // 将 “x” 设为 “y的左孩子”
 p[x] ← y                // 将 “x的父节点” 设为 “y”
```

### 右旋

右旋的定义如下：

> 以某个结点作为支点(旋转结点)，其左子结点变为旋转结点的父结点，左子结点的右子结点变为旋转结点的左子结点，右子结点保持不变

右旋示意图如下：

![红黑树右旋](http://cdn.zzwzdx.cn/blog/红黑树右旋.jpg&blog)

右旋的伪代码《算法导论》：参考上面的示意图和下面的伪代码，理解“红黑树T的节点y进行右旋”是如何进行的。 

```java
RIGHT-ROTATE(T, y)  
 x ← left[y]             // 前提：这里假设y的左孩子为x。下面开始正式操作
 left[y] ← right[x]      // 将 “x的右孩子” 设为 “y的左孩子”，即 将β设为y的左孩子
 p[right[x]] ← y         // 将 “y” 设为 “x的右孩子的父亲”，即 将β的父亲设为y
 p[x] ← p[y]             // 将 “y的父亲” 设为 “x的父亲”
 if p[y] = nil[T]       
 then root[T] ← x                 // 情况1：如果 “y的父亲” 是空节点，则将x设为根节点
 else if y = right[p[y]]  
           then right[p[y]] ← x   // 情况2：如果 y是它父节点的右孩子，则将x设为“y的父节点的左孩子”
           else left[p[y]] ← x    // 情况3：(y是它父节点的左孩子) 将x设为“y的父节点的左孩子”
 right[x] ← y            // 将 “y” 设为 “x的右孩子”
 p[y] ← x                // 将 “y的父节点” 设为 “x”
```

## 红黑树插入

在分析红黑树的插入之前，我们先将节点的名称做如下规范：

* I节点：插入节点
* P节点：插入节点的父节点
* PP节点：插入节点的祖父节点
* S节点：插入节点的叔叔节点

红黑树的插入操作可以简单的分为两个步骤，它们分别是一、找到插入的位置，二、插入和自平衡。插入操作的步骤如下：

1. 从根节点开始查找；
2. 如果根节点为空，则将插入的节点作为根节点，然后结束。
3. 若根结点不为空，那么把根结点作为当前结点；
4. 若当前结点为null，返回当前结点的父结点，结束。
5. 若当前结点key等于查找key，那么该key所在结点就是插入结点，更新结点的值，结束。
6. 若当前结点key大于查找key，把当前结点的左子结点设置为当前结点，重复步骤4；
7. 若当前结点key小于查找key，把当前结点的右子结点设置为当前结点，重复步骤4；

插入位置已经找到，把插入结点放到正确的位置就可以啦，但插入结点应该是什么颜色呢？答案是**红色**。理由很简单，红色在父结点（如果存在）为黑色结点时，红黑树的黑色平衡没被破坏，不需要做自平衡操作。但如果插入结点是黑色，那么插入位置所在的子树黑色结点总是多1，必须做自平衡。

插入情景和处理如下所示

* **情景1**：红黑树为空树

    处理：

    * 把插入的节点作为根节点，并将节点颜色设置为黑色

* **情景2**：插入节点的Key已经存在

    处理：

    * 把I设置为当前节点的颜色
    * 更新当前接的值为插入节点的值

* **情景3**：插入节点的父节点为黑色节点

    处理：

    * 直接插入

* **情景4**：插入节点的父节点为红色节点，这种情况又分如下几种情景：

    * **情景4.1**：叔叔节点存在并且为红色节点

        处理：

        * 将P(父节点)和S(叔叔节点)设置为黑色
        * 将PP(祖父节点)设置为红色
        * 把PP（祖父节点）设置为当前插入节点，即，之后继续对“当前节点”进行操作。

    * **情景4.2**：叔叔节点不存在或者为黑色节点，并且插入节点的父节点是祖父节点的左子节点，这种情况又分为以下2中情况：

        * **情景4.2.1**：插入节点是其父节点的左子节点

            处理：

            * 将P（父节点）设置为黑色
            * 将PP（祖父节点）设置为红色
            * 对PP（祖父节点）进行右旋

        * **情景4.2.2**：插入节点是其父节点的右子节点

            处理：

            * 对P（父节点）进行左旋
            * 把P（父节点）设置为当前节点，得到情景4.2.1
            * 进行情景4.2.1的处理

    * **情景4.3**：叔叔节点不存在或者为黑色节点，并且插入节点的父节点是祖父节点的右子节点，，这种情况又分为以下2中情况：

        * **情景4.3.1**：插入节点是其父节点的左子节点

            处理：

            * 将P（父节点）设置为黑色
            * 将PP（祖父节点）设置为红色
            * 对PP（祖父节点）进行左旋

        * **情景4.3.2**：插入节点是其父节点的右子节点

            处理：

            * 对P（父节点）进行右旋
            * 把P（父节点）设置为当前节点，得到情景4.3.1
            * 进行情景4.3.1的处理

上述插入的情景非常多，有的也比较复杂，接下来我们一一的进行分析。

### 情景1：红黑树为空树

最简单的一种情景，直接把插入结点作为根结点就行，但注意，根据红黑树性质2：根节点是黑色。还需要把插入结点设为黑色。

处理策略：

* 把插入结点作为根结点，并把结点设置为黑色

### 插入情景2：插入结点的Key已存在

插入结点的Key已存在，既然红黑树总保持平衡，在插入前红黑树已经是平衡的，那么把插入结点设置为将要替代结点的颜色，再把结点的值更新就完成插入。

处理策略：

- 把I设为当前结点的颜色
- 更新当前结点的值为插入结点的值

### 插入情景3：插入结点的父结点为黑结点

由于插入的结点是红色的，当插入结点的黑色时，并不会影响红黑树的平衡，直接插入即可，无需做自平衡。

处理策略：

* 直接插入。

### 插入情景4：插入结点的父结点为红结点

再次回想下红黑树的性质2：根结点是黑色。**如果插入的父结点为红结点，那么该父结点不可能为根结点，所以插入结点总是存在祖父结点**。这点很重要，因为后续的旋转操作肯定需要祖父结点的参与。

情景4又分为很多子情景，下面将进入重点部分。

#### 插入情景4.1：叔叔结点存在并且为红结点

从红黑树性质4可以，祖父结点肯定为黑结点，因为不可以同时存在两个相连的红结点。那么此时该插入子树的红黑层数的情况是：黑红红。显然最简单的处理方式是把其改为：红黑红。如下图所示：

![红黑树插入情景4.1](http://cdn.zzwzdx.cn/blog/红黑树插入情景4.1.png&blog)

从上图可以看到，处理的策略是：

- 将P和S设置为黑色
- 将PP设置为红色
- 把PP设置为当前插入结点

可以看到，我们把PP结点设为红色了，如果PP的父结点是黑色，那么无需再做任何处理；但如果PP的父结点是红色，根据性质4，此时红黑树已不平衡了，所以还需要把PP当作新的插入结点，继续做插入操作自平衡处理，直到平衡为止。

试想下PP刚好为根结点时，那么根据性质2，我们必须把PP重新设为黑色，那么树的红黑结构变为：黑黑红。换句话说，从根结点到叶子结点的路径中，黑色结点增加了。**这也是唯一一种会增加红黑树黑色结点层数的插入情景**。

####  插入情景4.2：叔叔结点不存在或为黑结点，并且插入结点的父亲结点是祖父结点的左子结点

叔叔结点非红即为叶子结点(Nil)。因为如果叔叔结点为黑结点，而父结点为红结点，那么叔叔结点所在的子树的黑色结点就比父结点所在子树的多了，这不满足红黑树的性质5。后续情景同样如此，不再多做说明了。

前文说了，需要旋转操作时，肯定一边子树的结点多了或少了，需要租或借给另一边。插入显然是多的情况，那么把多的结点租给另一边子树就可以了。

##### 插入情景4.2.1：插入结点是其父结点的左子结点

处理策略：

* 将P节点设置为黑色
* 将PP节点设置为红色
* 对PP节点进行右旋

具体处理如下图所示：

![红黑树插入情景4.2.1](http://cdn.zzwzdx.cn/blog/红黑树插入情景4.2.1.png&blog)

#####  插入情景4.2.2：插入结点是其父结点的右子结点

这种情景显然可以转换为情景4.2.1，如图所示，不做过多说明了。

处理策略：

- 对P进行左旋
- 把P设置为插入结点，得到情景4.2.1
- 进行情景4.2.1的处理

![红黑树插入情景4.2.2](http://cdn.zzwzdx.cn/blog/红黑树插入情景4.2.2.png&blog)

####  插入情景4.3：叔叔结点不存在或为黑结点，并且插入结点的父亲结点是祖父结点的右子

该情景对应情景4.2，只是方向反转，不做过多说明了，直接看图。

##### 插入情景4.3.1：插入结点是其父结点的右子结点
处理策略：

- 将P设为黑色
- 将PP设为红色
- 对PP进行左旋

![红黑树插入情景4.3.1](http://cdn.zzwzdx.cn/blog/红黑树插入情景4.3.1.png&blog)

#####  插入情景4.3.2：插入结点是其父结点的左子结点

处理策略：

* 对P进行右旋
* 把P设置为插入节点，得到情景4.3.1
* 进行4.3.1的处理

![红黑树插入情景4.3.2](http://cdn.zzwzdx.cn/blog/红黑树插入情景4.3.2.png&blog)

到这里红黑树插入的所有情景都分析完成了，后面分析红黑树的删除操作。

### 红黑树的删除

相比较插入操作，删除操作更为复杂些。首先我们需要确定需要删除节点有几个儿子，如果有两个儿子节点，那么问题需要转化为删除另一个只有一个儿子的节点的问题（这里所指的儿子，为非叶子节点的儿子）。在删除带有两个非叶子儿子节点的时候，我们要么找到它左子树中的最大元素（前驱节点），要么找到右子树中的最小元素（后继节点），并把它的值转移到要删除的节点中。我们接着删除我们从中复制出来值的那个节点（前驱或者后继节点），它必定有少于两个非叶子节点的儿子。因为只复制了值，没有复制颜色，不违反任何限制，这就把问题简化为如何删除最多有一个儿子节点的问题。它不关心这个节点是最初要删除的节点还是我们从中复制出值的那个节点。

接下来我们只需要讨论删除是有一个儿子的节点（**如果它两个儿子都为空，即均为叶子，我们任意将其中一个看作它的儿子**）。在展开说明之前，我们先做一些假设，方便说明。这里假设最终被删除的节点为`X`（至多只有一个孩子节点），其孩子节点为`N`，`X`的兄弟节点为`S`，`S`的左节点为 S<sub>L</sub>，右节点为 S<sub>R</sub>。在这个基础上，我们就来展开红黑树删除节点的几种情况：

1. X节点为红色节点，那么X的父节点和儿子节点一定是黑色的。所以我们可以简单的用它的黑色儿子节点替换它，并不会破话性质3和性质4。通过被删除节点的所有路径只是少了一个红色节点，这样可以继续保证性质5。如下所示：

    ![红黑树删除情景1](http://cdn.zzwzdx.cn/blog/红黑树删除情景一.png&blog)

2. X节点是黑色节点，N节点为红色节点，这种情况用它的红色儿子顶替上来的话，会破坏性质5，但是如果我们重绘它的儿子为黑色，则曾经通过它的所有路径将通过它的黑色儿子，这样可以继续保持性质5。如下图所示：

    ![1564646164370](http://cdn.zzwzdx.cn/blog/红黑树删除情景二.png&blog)

3. X节点是黑色节点，N节点也是黑色节点，这种情况比较复杂。（这种情况下该结点的两个儿子都是叶子结点，否则若其中一个儿子是黑色非叶子结点，另一个儿子是叶子结点，那么从该结点通过非叶子结点儿子的路径上的黑色结点数最小为2，而从该结点到另一个叶子结点儿子的路径上的黑色结点数为1，违反了性质5）。我们首先把要删除的节点X替换为它的儿子N。N 沿用 X 对于长辈和晚辈的称呼，需要清楚这里实际删除的是 X 结点，并且删除之后通过 N 的路径长度减 1。这种情景下删除分为一下集中情况：

    1. N是新的根

        这种情况是X根节点的情况，在删除X后，N就变成了新的根了，不在需要做任何处理。

    2. S是红色节点，其它为黑色节点。（**这种情况下为什么要做处理，是因为再删除前树是一颗红黑树，但是在删除了X后，那么红黑树就遭到了破坏**）。这种情况下我们是对N的父节点进行左旋操作，把红色兄弟转换成N的祖父，我们接着对调N的父亲和祖父的颜色。。完成这两个操作后，尽管所有路径上黑色节点的数目没有改变，但现在N有了一个黑色的兄弟和一个红色的父亲（它的新兄弟是黑色因为它是红色S的一个儿子），所以我们可以接下去按**情形4**、**情形5**或**情形6**来处理。如下图所示：

        ![1564648858107](http://cdn.zzwzdx.cn/blog/红黑树删除情景3.2.png&blog)

    3.  N的父亲、S和S的儿子都是黑色的。在这种情形下，我们简单的重绘S为红色。结果是通过S的所有路径，它们就是以前*不*通过N的那些路径，都少了一个黑色节点。因为删除N的初始的父亲使通过N的所有路径少了一个黑色节点，这使事情都平衡了起来。但是，**通过P的所有路径现在比不通过P的路径少了一个黑色节点，所以仍然违反性质5(P可能是一颗子树)。**要修正这个问题，我们要从**情形1**开始，在P上做重新平衡处理。

        ![1564649405273](http://cdn.zzwzdx.cn/blog/红黑树删除情景3.3.png&blog)

    4. N 的父节点是红色，S 和 S 孩子为黑色。这种情况比较简单，我们只需交换 P 和 S 颜色即可。这样所有通过 N 的路径上增加了一个黑色节点，所有通过 S 的节点的路径必然也通过 P 节点，由于 P 与 S 只是互换颜色，并不影响这些路径。
    
    ![1564652315813](http://cdn.zzwzdx.cn/blog/红黑数删除情景3.4.png&blog)
    
    5. S 为黑色，S 的左孩子为红色，右孩子为黑色。N 的父节点颜色可红可黑，且 N 是 P 左孩子。这种情况下对 S 进行右旋操作，并互换 S 和 S<sub>L</sub> 的颜色。此时，所有路径上的黑色数量仍然相等，N 兄弟节点的由 S 变为了 S<sub>L</sub>，而 S<sub>L</sub> 的右孩子变为红色。接下来我们到情况六继续分析。
    
        ![1564652790772](http://cdn.zzwzdx.cn/blog/红黑树删除情景3.5.png&blog)
    
    6. S是黑色，S的右儿子是红色，而N是它父亲的左儿子。在这种情形下我们在N的父亲上做左旋转，这样S成为N的父亲（P）和S的右儿子的父亲。我们接着交换N的父亲和S的颜色，并使S的右儿子为黑色。子树在它的根上的仍是同样的颜色，所以性质3没有被违反。但是，N现在增加了一个黑色祖先：要么N的父亲变成黑色，要么它是黑色而S被增加为一个黑色祖父。所以，通过N的路径都增加了一个黑色节点。
    
        此时，如果一个路径不通过N，则有两种可能性：
    
        - 它通过N的新兄弟。那么它以前和现在都必定通过S和N的父亲，而它们只是交换了颜色。所以路径保持了同样数目的黑色节点。
        - 它通过N的新叔父，S的右儿子。那么它以前通过S、S的父亲和S的右儿子，但是现在只通过S，它被假定为它以前的父亲的颜色，和S的右儿子，它被从红色改变为黑色。合成效果是这个路径通过了同样数目的黑色节点。
    
        ![1564653320611](http://cdn.zzwzdx.cn/blog/红黑树删除情景3.6.png&blog)

### concurrentHashMap中红黑树插入

见面介绍完了红黑树的插入和删除操作后，我们来看看ConcurrentHashMap中有关红黑树的操作。首先我们来看ConcurrentHashMap中`put`操作中与红黑树有关的部分，其定义如下：

```java
else if (f instanceof TreeBin) {
    Node<K,V> p;
    binCount = 2;
    if ((p = ((TreeBin<K,V>)f).putTreeVal(hash, key,value)) != null) {
        //如果p节点不为空，则表示hash和key在此红黑树中已经存在，则使用新的value替换p节点的value
        oldVal = p.val;
        if (!onlyIfAbsent)
            p.val = value;
    }
}
```

这一部分的逻辑是，如果节点`f`是`TreeBin`类型的，则调用`putTreeVal`将key和value插入到对应的位置。接下来我们看看`putTreeVal`方法的定义：

```java
final TreeNode<K,V> putTreeVal(int h, K k, V v) {
    Class<?> kc = null;
    boolean searched = false;
    //从红黑树的根节点开始查找，找到合适的插入位置
    for (TreeNode<K,V> p = root;;) {
        int dir, ph; K pk;
        // 如果根节点为空，则表示红黑树未创建，将k,v构建成新的TreeNode，并返回
        if (p == null) {
            first = root = new TreeNode<K,V>(h, k, v, null, null);
            break;
        }
        // 如果P节点的hash值大于要插入的hash值,则将dir置为-1
        else if ((ph = p.hash) > h)
            dir = -1;
        //如果P节点的hash值小于要插入的hash值,则将dir置为1
        else if (ph < h)
            dir = 1;
        //如果P节点的key值等于要插入的key值,则返回节点p
        else if ((pk = p.key) == k || (pk != null && k.equals(pk)))
            return p;
        //这种情况是hash值一致，但是key却不相同，这就产生了hash冲突
        //如果 comparableClassFor方法返回不为null,则调用compareComparables方法
        // comparableClassFor(k)方法是返回k的类型，如果k实现了Comparable接口，则返回k对应的class,否则返回null
        else if ((kc == null &&
                  (kc = comparableClassFor(k)) == null) ||
                 (dir = compareComparables(kc, k, pk)) == 0) {
            //如果已经遍历一遍红黑树还是没要找的hash和key对应相等的节点，则下次不再遍历
            if (!searched) {
                TreeNode<K,V> q, ch;
                searched = true;
                //先从左边子树查找是否有相同和hash和key,若果存在则返回q节点
                //若果左边子树查找不到，则从右子树开始查找，查找到返回q节点
                if (((ch = p.left) != null &&
                     (q = ch.findTreeNode(h, k, kc)) != null) ||
                    ((ch = p.right) != null &&
                     (q = ch.findTreeNode(h, k, kc)) != null))
                    return q;
            }
            dir = tieBreakOrder(k, pk);
        }

        TreeNode<K,V> xp = p;
        if ((p = (dir <= 0) ? p.left : p.right) == null) {
            TreeNode<K,V> x, f = first;
            //构建新节点X，x.next = f,x.parent = xp
            first = x = new TreeNode<K,V>(h, k, v, f, xp);
            if (f != null)
                f.prev = x;
            if (dir <= 0)
                //将x放到p的左子树
                xp.left = x;
            else
                //将x放到p的右子树
                xp.right = x;
            if (!xp.red)
                //如果xp不是红色的节点，则将x置位红色的节点
                x.red = true;
            else {
                lockRoot();
                try {
                    //调整红黑树结构
                    root = balanceInsertion(root, x);
                } finally {
                    unlockRoot();
                }
            }
            break;
        }
    }
    assert checkInvariants(root);
    return null;
}
```

分析完上面代码，最后我们来梳理下`putTreeVal`方法的处理逻辑：

1. 从红黑树的根节点遍历,将根节点作为当前节点p；

2. 如果根节点为null,则将当前传入的key和value构建为TreeNode作为新的根节点

3. 若果根节点不为null,则比较当前节点p的hash值和传入的hash值

    1. 若果传入的hash值小于p节点的hash值，则将dir赋值为-1

    2. 若果传入的hash值大于p节点的hash值，则将dir赋值为1

    3. 若果传入的hash值和key与p节点的hash值和key相同，则返回p节点

    4. 如果传入的hash值与p节点的hash值相等，但是key与p节点的key不相等，则表示hash冲突，此时先从根节点的左子树开始查看，如果找到节点的hash和key与传入的hash和key值相等，则返回，否则从根节点的又子树开始查找，找到则返回，如果找不到，则调用`tieBreakOrder`方法比较，`tieBreakOrder`方法的定义如下:

        ```java
        static int tieBreakOrder(Object a, Object b) {
            int d;
            if (a == null || b == null ||
                (d = a.getClass().getName().
                 compareTo(b.getClass().getName())) == 0)
                d = (System.identityHashCode(a) <= System.identityHashCode(b) ?
                     -1 : 1);
            return d;
        }
        ```

        从源码中，我们可以看到，最终使用的是`System.identityHashCode`方法来比价两个hash的值的大小。

4. 判断dir的值

    1. 如果dir<=0,则将当前节点p的左子节点作为新的当前节点,即p=p.left
    2. 如果dir>0,则将当前节点p的右子节点作为新的当前节点,即p=p.right

5. 若果当前节p`不为`null，则重复步骤3和步骤4，否则将传入的hash、key 和value构建成新的TreeNode节点x。

    1. 将根节点的前驱节点置位x,即f.prev = x;
    2. 若果dir<=0,则将构建的x节点作为当前节点p的左子节点，即p.left = x;
    3. 否则，将构建的x节点作为当前节点p的右子节点，即p.right = x;
    4. 如果当前节点p不是红色，则将x节点置位红色
    5. 调整红黑树，调用`balanceInsertion`方法。

接下来，我们来分析下红黑树的重点`balanceInsertion`方法，此方法的作用就是调整红黑树使其达到自平衡。方法源码定义如下：

```java
static <K,V> TreeNode<K,V> balanceInsertion(TreeNode<K,V> root,TreeNode<K,V> x) {
    //将x节点的颜色更新为红色
    x.red = true;
    for (TreeNode<K,V> xp, xpp, xppl, xppr;;) {
        //如果x.parent=null，即表示改红黑树没有任何节点，将x节点的颜色设置成黑色，并将x做为根节点。
        //保证了红黑树的属性一，即红黑树的根节点为黑色节点
        if ((xp = x.parent) == null) {
            x.red = false;
            return x;
        }
        //如果x的父节点xp为黑色节点，或者x的父节点就是根节点，则不作任何处理，直接返回根节点
        else if (!xp.red || (xpp = xp.parent) == null)
            return root;
        //x父节点p为红色
        //------------------------
        //x的父节点xp是祖父节点xpp的左子节点
        if (xp == (xppl = xpp.left)) {
            //xppr为祖父节点的右子节点，且为红色，即x的叔父节点为红色
            //则根据红黑树的特性，我们可以推断出去祖父节点为黑色，父节点为红色，这种情景下直接交换颜色即可
            if ((xppr = xpp.right) != null && xppr.red) {
                //将叔父节点转为黑色
                xppr.red = false;
                //将父节点转为黑色
                xp.red = false;
                //将祖父节点转为红色
                xpp.red = true;
                //将祖父节点当做当前节点x，回溯挑战x的父节点的颜色
                x = xpp;
            }
            //若果x节点的叔父节点不存在或者为黑色
            else {
                //如若x为右子节点
                if (x == xp.right) {
                    //先左旋
                    root = rotateLeft(root, x = xp);
                    xpp = (xp = x.parent) == null ? null : xp.parent;
                }
                //x为其父节点xp的左子节点
                if (xp != null) {
                    //将x的父节点xp设置成黑色
                    xp.red = false;
                    //若果祖父节点不为null,则将祖父节点设置为红色，并且以祖父节点作为支点进行右旋
                    if (xpp != null) {
                        xpp.red = true;
                        //右旋
                        root = rotateRight(root, xpp);
                    }
                }
            }
        }
        //下面的情况入上面正好对应
        //x的父节点xp是祖父节点xpp的右子节点
        else {
            //x节点的叔父节点存在并且为红色,直接变换颜色即可
            if (xppl != null && xppl.red) {
                xppl.red = false;
                xp.red = false;
                xpp.red = true;
                x = xpp;
            }
            //若果x的叔父节点不存在，或者叔父节点的颜色为黑色
            else {
                //若果x的父节点的左子节点
                if (x == xp.left) {
                    //以父节点xp为支点，进行右旋
                    root = rotateRight(root, x = xp);
                    xpp = (xp = x.parent) == null ? null : xp.parent;
                }
                if (xp != null) {
                    xp.red = false;
                    if (xpp != null) {
                        xpp.red = true;
                        //以祖父节点xpp为支点进行左旋
                        root = rotateLeft(root, xpp);
                    }
                }
            }
        }
    }
}
```

`balanceInsertion`方法的逻辑在前面分析红黑树的插入的时候都有分析，若果觉得`balanceInsertion`方法看的有点晕，请结合红黑树的插入部分的分析一起看。下面我们结合实际数据再次详细的分析下`putTreeVal`方法的原理。这里我 们以{5,3,4,9,12,10,11,1}这组数据为例。

第一步：在插入节点5时，发现根节点为空，因此直接将节点5作为根节点

![](http://cdn.zzwzdx.cn/blog/putTreeVal第一步.png&blog)

第二步：在插入节点3时，发现节点3的hash值小于根节点的hash值，因此将节点插入到根节点的左侧，并将节点3的颜色调整为红色。其部逻辑和结构如下：

```java
if ((p = (dir <= 0) ? p.left : p.right) == null) {
    TreeNode<K,V> x, f = first;
    first = x = new TreeNode<K,V>(h, k, v, f, xp);
    if (f != null)
        f.prev = x;
    //dir <=0,将x节点插入到其父节点的左侧，否则插入其父节点的右侧
    if (dir <= 0)
        xp.left = x;
    else
        xp.right = x;
    //插入的节点x的父节点的颜色为黑色，则将x节点的颜色调整为红色
    if (!xp.red)
        x.red = true;
    else {
        lockRoot();
        try {
            root = balanceInsertion(root, x);
        } finally {
            unlockRoot();
        }
    }
    break;
}
```

![](http://cdn.zzwzdx.cn/blog/putTreeVal第二步.png&blog)

第三步：插入节点4，此时发现节点4的hash值小于根节点的hash值，但是发现根节点的左子节点3不为null,则继续比较节点4的hash值和节点3的hash值，发现节点4的hash值大于节点3的hash值，因此节点4插入到节点3的右侧。进行平衡处理时，现将插入节点4的颜色更新为红色，此时插入节点3和父节点4的颜色相同，产生冲突，想左旋然后变换父节点和祖父节点的颜色，最后右旋，源码片段如下：

```java
if (x == xp.right) {
    //此处x = xp是非常关键的一点，将x的父节点指向x
    //在左旋完成后，原来x节点变成xp的父节点，x变成了了xp节点,即插入节点x转变成原来的xp节点了
    root = rotateLeft(root, x = xp);
    xpp = (xp = x.parent) == null ? null : xp.parent;
}
if (xp != null) {
    xp.red = false;
    if (xpp != null) {
        xpp.red = true;
        root = rotateRight(root, xpp);
    }
}
```



![](http://cdn.zzwzdx.cn/blog/putTreeVal 第三步.png&blog)

第四步：插入节点9，此时节点9的hash值大于根节点4的hash值，因此在和根节点4的右子节点5进行比较，发现hash值大于节点5的hash值，且节点5没有右子节点，因此将节点9放入到节点5的右子节点上。演变过程如下：

![](http://cdn.zzwzdx.cn/blog/putTreeVal 第四步.png&blog)

第五步：插入节点12，根据上面的规则，我们知道节点12插入到节点9的右子节点上，其演变过程如下：

![](http://cdn.zzwzdx.cn/blog/putTreeVal 第五步.png&blog)

第六步：插入节点10，根据规则，我们知道节点10会插入到节点12的左子节点处，其演变过程如下：

![](http://cdn.zzwzdx.cn/blog/putTreeVal 第六步.png&blog)

第七步：插入节点11，其演变过程如下：

![](http://cdn.zzwzdx.cn/blog/putTreeVal 第七步.png&blog)

第八步：插入节点1，其演变过程如下：

![](http://cdn.zzwzdx.cn/blog/putTreeVal 第八步.png&blog)

到此，ConcurrentHashMap中关于红黑树插入的操作分析完毕，并且也使用了一个示例来完整的演示了put操作，从上面的分析我们看到红黑树的put操作还是非常麻烦的，但是只要我们熟记了其插入的情景后，分析问题也会变得简单。

### ConcurrentHashMap中红黑树的演变

ConcurrentHashMap中默认的数据结构是散列，只有当链表的长度大于阈值(默认为8)时，链表会转换为红黑树，链表演变为红黑树的源码如下：

```java
if (binCount != 0) {
    //链表长度大于阈值，则转换为红黑树
    if (binCount >= TREEIFY_THRESHOLD)
        treeifyBin(tab, i);
    if (oldVal != null)
        return oldVal;
    break;
}
/**
* 将链表中的每个元素构建成TreeNode
*/
private final void treeifyBin(Node<K,V>[] tab, int index) {
    Node<K,V> b; int n, sc;
    if (tab != null) {
        //如果数组的长度小于红黑树要求的最新容量，则进行扩容
        if ((n = tab.length) < MIN_TREEIFY_CAPACITY)
            tryPresize(n << 1);
        //链表存在，并且节点类型是Node
        else if ((b = tabAt(tab, index)) != null && b.hash >= 0) {
            //加锁
            synchronized (b) {
                if (tabAt(tab, index) == b) {
                    TreeNode<K,V> hd = null, tl = null;
                    for (Node<K,V> e = b; e != null; e = e.next) {
                        //遍历每个链表中的节点，并将其构建成TreeNode
                        TreeNode<K,V> p =
                            new TreeNode<K,V>(e.hash, e.key, e.val,
                                              null, null);
                        if ((p.prev = tl) == null)
                            hd = p;
                        else
                            tl.next = p;
                        tl = p;
                    }
                    //构建红黑树
                    setTabAt(tab, index, new TreeBin<K,V>(hd));
                }
            }
        }
    }
}
TreeBin(TreeNode<K,V> b) {
    super(TREEBIN, null, null, null);
    this.first = b;
    TreeNode<K,V> r = null;
    for (TreeNode<K,V> x = b, next; x != null; x = next) {
        next = (TreeNode<K,V>)x.next;
        x.left = x.right = null;
        //构建红褐树的根
        if (r == null) {
            x.parent = null;
            x.red = false;
            r = x;
        }
        else {
            //比较当前节点x的hash值
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
```

我们可以看到`TreeBin`方法的源码和`putTreeVal`方法的逻辑是一致的，上面对`putTreeVal`方法进行了分析，这里就不在赘述了。

### ConcurrentHashMap之红黑树的删除

concurrentHashMap中红黑树的删除源码定义如下：

```java
public V remove(Object key) {
    return replaceNode(key, null, null);
}

final V replaceNode(Object key, V value, Object cv) {
    int hash = spread(key.hashCode());
    for (Node<K,V>[] tab = table;;) {
        Node<K,V> f; int n, i, fh;
        if (tab == null || (n = tab.length) == 0 ||
            (f = tabAt(tab, i = (n - 1) & hash)) == null)
            break;
        else if ((fh = f.hash) == MOVED)
            tab = helpTransfer(tab, f);
        else {
            V oldVal = null;
            boolean validated = false;
            synchronized (f) {
                if (tabAt(tab, i) == f) {
                    //链表节点的删除，前面已经分析了
                    if (fh >= 0) {
                        validated = true;
                        for (Node<K,V> e = f, pred = null;;) {
                            K ek;
                            if (e.hash == hash &&
                                ((ek = e.key) == key ||
                                 (ek != null && key.equals(ek)))) {
                                V ev = e.val;
                                if (cv == null || cv == ev ||
                                    (ev != null && cv.equals(ev))) {
                                    oldVal = ev;
                                    if (value != null)
                                        e.val = value;
                                    else if (pred != null)
                                        pred.next = e.next;
                                    else
                                        setTabAt(tab, i, e.next);
                                }
                                break;
                            }
                            pred = e;
                            if ((e = e.next) == null)
                                break;
                        }
                    }
                    //红黑树节点的删除
                    else if (f instanceof TreeBin) {
                        validated = true;
                        TreeBin<K,V> t = (TreeBin<K,V>)f;
                        TreeNode<K,V> r, p;
                        if ((r = t.root) != null &&
                            //查找到待需要删除的节点p
                            (p = r.findTreeNode(hash, key, null)) != null) {
                            V pv = p.val;
                            if (cv == null || cv == pv ||
                                (pv != null && cv.equals(pv))) {
                                //如果不是替换该节点的值，则需要删除节点p
                                oldVal = pv;
                                if (value != null)
                                    p.val = value;
                                //删除节点p
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

删除红黑树节点的具体逻辑在`removeTreeNode`方法中，该方法源码定义如下：

```java
//需要删除的节点p
final boolean removeTreeNode(TreeNode<K,V> p) {
    //p的后继节点
    TreeNode<K,V> next = (TreeNode<K,V>)p.next;
    //p的前驱节点
    TreeNode<K,V> pred = p.prev;  // unlink traversal pointers
    TreeNode<K,V> r, rl;
    if (pred == null)
        first = next;
    else
        pred.next = next;
    if (next != null)
        next.prev = pred;
    //红黑树为空
    if (first == null) {
        root = null;
        return true;
    }
    //红黑树节点太少，返回true，将红黑树转成链表
    if ((r = root) == null || r.right == null || // too small
        (rl = r.left) == null || rl.left == null)
        return true;
    lockRoot();
    try {
        TreeNode<K,V> replacement;
        TreeNode<K,V> pl = p.left;
        TreeNode<K,V> pr = p.right;
        //要删除的节点p有2个子节点
        if (pl != null && pr != null) {
            TreeNode<K,V> s = pr, sl;
            //找到右子树的最左子节点，即替换删除节点的节点
            while ((sl = s.left) != null) // find successor
                s = sl;
            //调整删除节点和替换节点s的颜色
            boolean c = s.red; s.red = p.red; p.red = c; // swap colors
            TreeNode<K,V> sr = s.right;
            TreeNode<K,V> pp = p.parent;
            //删除节点的右子节点下面不存在孩子节点
            if (s == pr) { // p was s's direct parent
                p.parent = s;
                s.right = p;
            }
             //删除节点的右子节点下面存在孩子节点
            else {
                TreeNode<K,V> sp = s.parent;
                if ((p.parent = sp) != null) {
                    if (s == sp.left)
                        sp.left = p;
                    else
                        sp.right = p;
                }
                //将替代节点的右子节点调整为删除节点的右子节点
                if ((s.right = pr) != null)
                    pr.parent = s;
            }
            //断开删除节点p的左子树
            p.left = null;
            if ((p.right = sr) != null)
                sr.parent = p;
            //将替代接的的左子节点替换成删除节点的左子节点
            if ((s.left = pl) != null)
                //将删除节点的左子节点的父记得设置为替代节点
                pl.parent = s;
            //将替代节点s的父节点设置为删除节点的父节点
            if ((s.parent = pp) == null)
                r = s;
            else if (p == pp.left)
                //将删除节点父节点pp的左子节点调整为替代节点s
                pp.left = s;
            else
                pp.right = s;
            if (sr != null)
                replacement = sr;
            else
                replacement = p;
        }
        else if (pl != null)
            replacement = pl;
        else if (pr != null)
            replacement = pr;
        else
            replacement = p;
        if (replacement != p) {
            TreeNode<K,V> pp = replacement.parent = p.parent;
            if (pp == null)
                r = replacement;
            else if (p == pp.left)
                pp.left = replacement;
            else
                pp.right = replacement;
            p.left = p.right = p.parent = null;
        }

        root = (p.red) ? r : balanceDeletion(r, replacement);

        if (p == replacement) {  // detach pointers
            TreeNode<K,V> pp;
            if ((pp = p.parent) != null) {
                if (p == pp.left)
                    pp.left = null;
                else if (p == pp.right)
                    pp.right = null;
                p.parent = null;
            }
        }
    } finally {
        unlockRoot();
    }
    assert checkInvariants(root);
    return false;
}
```

我们对上面源码的逻辑进行分析如下：

1. 在红黑树中查找到要删除的节点p
2. 如果红黑树为空树或者节点的个数太少，则将红黑树转换为链表，并删除要删除的节点
3. 如果要删除的节点存在左右连个孩子节点，则找到删除节点p右子树中的最左孩子节点s
    1. 交换替换节点s和要删除节点p的颜色
    2. 如果待删除节点的右孩子节点pr就是替代的节点s,那么将删除节点p的父节点指向s,并将替代节点s的右孩子节点指向p
    3. 如果待删除节点p的右孩子pr节点上还有孩子节点
        1. 如果sp节点不为空，将p的parent指向sp,并将p作为sp的左孩子或者右孩子
        2. 将pr指向s的右孩子节点，并将pr的parent指向s
    4. 将删除节点的做孩子置位null
    5. 将删除节点p的左子节点pl指向为s的左子节点
    6. 将删除记得p的父节点pp的左自己的指向s
4. 如果删除节点只有一个孩子节点，则用该孩子节点替代自己
5. 自平衡处理

上面删除逻辑不是很好理解，下面我们还是用实际的实例来颜色删除的逻辑。还是以上面插入的示例为例，我们要删除节点9,此时步骤如下：

第一步：查找到要删除的节点p

![](http://cdn.zzwzdx.cn/blog/remove 第一步.png&blog)

第二步：删除节点p下面有2个孩子节点，找到替代节点s,  并将pr的左孩子节点设置为p, 并将s的右孩子节点设置为删除节点p的右孩子节点,其演变结果如下：

![](http://cdn.zzwzdx.cn/blog/remove 第二步.png&blog)

第三步：将p节点的左自己的设置为null,然后将s的左子节点设置为pl,将pp的右子节点设置为s

![](http://cdn.zzwzdx.cn/blog/remove 第三步.png&blog)

第四步：自平衡后将p的父节点的左子节点设置为null

![](http://cdn.zzwzdx.cn/blog/remove 第四步.png&blog)

到这里，我们看到删除节点p已经完成了。这里只讨论了删除的一种情况，删除还有其它的2中情况是比较简单的这里LZ就不在分析了，大家可以参照LZ的分析自己分析删除节点p只有一个孩子的情况。

