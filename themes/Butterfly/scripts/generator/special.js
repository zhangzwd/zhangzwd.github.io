/* global hexo */

'use strict';
const pagination = require('hexo-pagination');

hexo.config.category_generator = Object.assign({
    per_page: typeof hexo.config.per_page === 'undefined' ? 10 : hexo.config.per_page
}, hexo.config.category_generator);

hexo.extend.generator.register('special', function (locals) {
    const config = this.config;
    const perPage = config.category_generator.per_page;
    const paginationDir = config.pagination_dir || 'page';
    const orderBy = config.category_generator.order_by || '-date';

    return locals.pages.reduce((result, page) => {

        if(!page.special) return result

        let path = page.path.replace("index.html","");
        const posts = locals.posts.filter(post=>post.special == page.special).sort(orderBy)
        const data = pagination(path, posts, {
            perPage,
            layout: ['special', 'archive', 'index'],
            format: paginationDir + '/%d/',
            data: {
                title: page.title
            }
        });
        return result.concat(data);
    }, []);
});
