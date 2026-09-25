<?php
/**
 * Plugin Name:       Mellox GEO
 * Plugin URI:        https://mellox.ai
 * Description:       Lets Mellox fix AI-search and SEO issues on this site: page titles, meta descriptions, canonical links, structured data (JSON-LD), robots.txt and llms.txt. Every change is made through your own WordPress account and can be undone from Mellox.
 * Version:           1.0.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Mellox
 * License:           GPL-2.0-or-later
 * Text Domain:       mellox-geo
 *
 * REST API (namespace mellox/v1), authenticated with the WordPress account
 * Mellox is connected as (Application Password or WordPress.com OAuth):
 *
 *   GET  /ping                     public: plugin version and detected SEO plugin
 *   GET  /head?type=&id=           edit_post: Mellox head fields for one post/page
 *   POST /head                     edit_post: set them; returns the previous values
 *   GET  /site                     manage_options: site-wide schema, robots, llms.txt
 *   POST /site                     manage_options: set them; returns the previous values
 *
 * When Yoast SEO or Rank Math is active, title / description / canonical /
 * robots / Open Graph are written into THEIR fields, so they keep printing a
 * single set of tags. Otherwise this plugin prints them itself. JSON-LD is
 * always printed by this plugin, in its own script tag.
 */

if (!defined('ABSPATH')) {
    exit;
}

define('MELLOX_GEO_VERSION', '1.0.0');
define('MELLOX_GEO_META', '_mellox_geo');
define('MELLOX_GEO_SITE_OPTION', 'mellox_geo_site');

/* ───────────────────────── helpers ───────────────────────── */

function mellox_geo_seo_plugin()
{
    if (defined('WPSEO_VERSION')) {
        return 'yoast';
    }
    if (defined('RANK_MATH_VERSION') || class_exists('RankMath')) {
        return 'rankmath';
    }
    if (defined('AIOSEO_VERSION') || function_exists('aioseo')) {
        return 'aioseo';
    }
    return null;
}

/** Head fields Mellox manages, with their sanitisers. */
function mellox_geo_head_fields()
{
    return array(
        'title'          => 'text',
        'description'    => 'text',
        'canonical'      => 'url',
        'noindex'        => 'bool',
        'og_title'       => 'text',
        'og_description' => 'text',
        'jsonld'         => 'jsonld',
    );
}

/**
 * JSON-LD: an array of objects, each re-encoded so nothing but data can reach
 * the page (JSON_HEX_TAG keeps "</script>" out). Returns null when invalid.
 */
function mellox_geo_clean_jsonld($value)
{
    if (is_string($value)) {
        $value = json_decode($value, true);
    }
    if (!is_array($value)) {
        return null;
    }
    $list = isset($value['@context']) || isset($value['@type']) ? array($value) : $value;
    $out = array();
    foreach ($list as $item) {
        if (!is_array($item) || (empty($item['@type']) && empty($item['@graph']))) {
            return null;
        }
        $out[] = $item;
        if (count($out) >= 10) {
            break;
        }
    }
    $encoded = wp_json_encode($out);
    if (!$encoded || strlen($encoded) > 60000) {
        return null;
    }
    return $out;
}

function mellox_geo_sanitize($kind, $value)
{
    switch ($kind) {
        case 'text':
            return is_null($value) ? '' : mb_substr(sanitize_text_field((string) $value), 0, 400);
        case 'url':
            return is_null($value) || $value === '' ? '' : esc_url_raw((string) $value, array('http', 'https'));
        case 'bool':
            return (bool) $value;
        case 'jsonld':
            if (is_null($value) || $value === '' || $value === array()) {
                return array();
            }
            return mellox_geo_clean_jsonld($value);
    }
    return null;
}

function mellox_geo_get_post_fields($post_id)
{
    $stored = get_post_meta($post_id, MELLOX_GEO_META, true);
    $stored = is_array($stored) ? $stored : array();
    $fields = array();
    foreach (mellox_geo_head_fields() as $key => $kind) {
        $fields[$key] = array_key_exists($key, $stored) ? $stored[$key] : ($kind === 'bool' ? false : ($kind === 'jsonld' ? array() : ''));
    }
    // What the active SEO plugin currently holds is the real "before".
    $seo = mellox_geo_seo_plugin();
    if ($seo === 'yoast') {
        $fields['title']          = (string) get_post_meta($post_id, '_yoast_wpseo_title', true);
        $fields['description']    = (string) get_post_meta($post_id, '_yoast_wpseo_metadesc', true);
        $fields['canonical']      = (string) get_post_meta($post_id, '_yoast_wpseo_canonical', true);
        $fields['noindex']        = get_post_meta($post_id, '_yoast_wpseo_meta-robots-noindex', true) === '1';
        $fields['og_title']       = (string) get_post_meta($post_id, '_yoast_wpseo_opengraph-title', true);
        $fields['og_description'] = (string) get_post_meta($post_id, '_yoast_wpseo_opengraph-description', true);
    } elseif ($seo === 'rankmath') {
        $robots                   = get_post_meta($post_id, 'rank_math_robots', true);
        $fields['title']          = (string) get_post_meta($post_id, 'rank_math_title', true);
        $fields['description']    = (string) get_post_meta($post_id, 'rank_math_description', true);
        $fields['canonical']      = (string) get_post_meta($post_id, 'rank_math_canonical_url', true);
        $fields['noindex']        = is_array($robots) && in_array('noindex', $robots, true);
        $fields['og_title']       = (string) get_post_meta($post_id, 'rank_math_facebook_title', true);
        $fields['og_description'] = (string) get_post_meta($post_id, 'rank_math_facebook_description', true);
    }
    return $fields;
}

function mellox_geo_set_post_fields($post_id, $input)
{
    $before = mellox_geo_get_post_fields($post_id);
    $stored = get_post_meta($post_id, MELLOX_GEO_META, true);
    $stored = is_array($stored) ? $stored : array();
    $applied = array();
    foreach (mellox_geo_head_fields() as $key => $kind) {
        if (!array_key_exists($key, $input)) {
            continue;
        }
        $clean = mellox_geo_sanitize($kind, $input[$key]);
        if ($clean === null) {
            return new WP_Error('mellox_invalid_field', sprintf('Invalid value for %s.', $key), array('status' => 400));
        }
        $stored[$key] = $clean;
        $applied[$key] = $clean;
    }
    $seo = mellox_geo_seo_plugin();
    if ($seo === 'yoast') {
        $map = array(
            'title' => '_yoast_wpseo_title',
            'description' => '_yoast_wpseo_metadesc',
            'canonical' => '_yoast_wpseo_canonical',
            'og_title' => '_yoast_wpseo_opengraph-title',
            'og_description' => '_yoast_wpseo_opengraph-description',
        );
        foreach ($map as $key => $meta) {
            if (array_key_exists($key, $applied)) {
                update_post_meta($post_id, $meta, $applied[$key]);
            }
        }
        if (array_key_exists('noindex', $applied)) {
            update_post_meta($post_id, '_yoast_wpseo_meta-robots-noindex', $applied['noindex'] ? '1' : '2');
        }
    } elseif ($seo === 'rankmath') {
        $map = array(
            'title' => 'rank_math_title',
            'description' => 'rank_math_description',
            'canonical' => 'rank_math_canonical_url',
            'og_title' => 'rank_math_facebook_title',
            'og_description' => 'rank_math_facebook_description',
        );
        foreach ($map as $key => $meta) {
            if (array_key_exists($key, $applied)) {
                update_post_meta($post_id, $meta, $applied[$key]);
            }
        }
        if (array_key_exists('noindex', $applied)) {
            update_post_meta($post_id, 'rank_math_robots', $applied['noindex'] ? array('noindex') : array('index'));
        }
    }
    update_post_meta($post_id, MELLOX_GEO_META, $stored);
    clean_post_cache($post_id);
    return array('before' => $before, 'after' => mellox_geo_get_post_fields($post_id), 'seo_plugin' => $seo);
}

function mellox_geo_site_defaults()
{
    return array(
        'organization_jsonld' => array(),
        'website_jsonld'      => array(),
        'robots_append'       => '',
        'llms_txt'            => '',
    );
}

function mellox_geo_get_site()
{
    $site = get_option(MELLOX_GEO_SITE_OPTION, array());
    return array_merge(mellox_geo_site_defaults(), is_array($site) ? $site : array());
}

/** robots.txt lines Mellox may add: directives only, never arbitrary text. */
function mellox_geo_clean_robots($value)
{
    $lines = preg_split('/\r\n|\r|\n/', (string) $value);
    $out = array();
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || preg_match('/^(User-agent|Allow|Disallow|Sitemap|Crawl-delay)\s*:\s*[^\s<>"]*$/i', $line)) {
            $out[] = $line;
        }
        if (count($out) >= 60) {
            break;
        }
    }
    return trim(implode("\n", $out));
}

/* ───────────────────────── REST API ───────────────────────── */

add_action('rest_api_init', function () {
    register_rest_route('mellox/v1', '/ping', array(
        'methods'             => 'GET',
        'permission_callback' => '__return_true',
        'callback'            => function () {
            return array(
                'plugin'     => 'mellox-geo',
                'version'    => MELLOX_GEO_VERSION,
                'seo_plugin' => mellox_geo_seo_plugin(),
            );
        },
    ));

    $object_args = array(
        'type' => array('required' => true, 'enum' => array('post', 'page')),
        'id'   => array('required' => true, 'type' => 'integer', 'minimum' => 1),
    );
    $can_edit = function (WP_REST_Request $request) {
        $id = (int) $request->get_param('id');
        $post = get_post($id);
        if (!$post || !in_array($post->post_type, array('post', 'page'), true)) {
            return new WP_Error('mellox_not_found', 'That post or page was not found.', array('status' => 404));
        }
        if ($post->post_type !== $request->get_param('type')) {
            return new WP_Error('mellox_type_mismatch', 'Wrong content type.', array('status' => 400));
        }
        return current_user_can('edit_post', $id);
    };

    register_rest_route('mellox/v1', '/head', array(
        array(
            'methods'             => 'GET',
            'permission_callback' => $can_edit,
            'args'                => $object_args,
            'callback'            => function (WP_REST_Request $request) {
                return array(
                    'fields'     => mellox_geo_get_post_fields((int) $request->get_param('id')),
                    'seo_plugin' => mellox_geo_seo_plugin(),
                );
            },
        ),
        array(
            'methods'             => 'POST',
            'permission_callback' => $can_edit,
            'args'                => $object_args,
            'callback'            => function (WP_REST_Request $request) {
                $fields = $request->get_param('fields');
                if (!is_array($fields)) {
                    return new WP_Error('mellox_invalid', 'fields must be an object.', array('status' => 400));
                }
                return mellox_geo_set_post_fields((int) $request->get_param('id'), $fields);
            },
        ),
    ));

    $can_manage = function () {
        return current_user_can('manage_options');
    };

    register_rest_route('mellox/v1', '/site', array(
        array(
            'methods'             => 'GET',
            'permission_callback' => $can_manage,
            'callback'            => function () {
                return array('site' => mellox_geo_get_site(), 'seo_plugin' => mellox_geo_seo_plugin());
            },
        ),
        array(
            'methods'             => 'POST',
            'permission_callback' => $can_manage,
            'callback'            => function (WP_REST_Request $request) {
                $input = $request->get_param('site');
                if (!is_array($input)) {
                    return new WP_Error('mellox_invalid', 'site must be an object.', array('status' => 400));
                }
                $before = mellox_geo_get_site();
                $next = $before;
                foreach (array('organization_jsonld', 'website_jsonld') as $key) {
                    if (array_key_exists($key, $input)) {
                        $clean = mellox_geo_sanitize('jsonld', $input[$key]);
                        if ($clean === null) {
                            return new WP_Error('mellox_invalid_field', sprintf('Invalid value for %s.', $key), array('status' => 400));
                        }
                        $next[$key] = $clean;
                    }
                }
                if (array_key_exists('robots_append', $input)) {
                    $next['robots_append'] = mellox_geo_clean_robots($input['robots_append']);
                }
                if (array_key_exists('llms_txt', $input)) {
                    $next['llms_txt'] = mb_substr(sanitize_textarea_field((string) $input['llms_txt']), 0, 50000);
                }
                update_option(MELLOX_GEO_SITE_OPTION, $next, false);
                return array('before' => $before, 'after' => mellox_geo_get_site());
            },
        ),
    ));
});

/* ───────────────────────── front end ───────────────────────── */

function mellox_geo_current_fields()
{
    if (!is_singular(array('post', 'page'))) {
        return null;
    }
    $stored = get_post_meta(get_queried_object_id(), MELLOX_GEO_META, true);
    return is_array($stored) ? $stored : null;
}

function mellox_geo_print_jsonld($items)
{
    foreach ((array) $items as $item) {
        $json = wp_json_encode($item, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP);
        if ($json) {
            echo '<script type="application/ld+json" data-mellox="1">' . $json . "</script>\n"; // phpcs:ignore WordPress.Security.EscapeOutput -- JSON encoded with JSON_HEX_TAG.
        }
    }
}

// Title, only when no SEO plugin owns it.
add_filter('pre_get_document_title', function ($title) {
    if (mellox_geo_seo_plugin()) {
        return $title;
    }
    $fields = mellox_geo_current_fields();
    return $fields && !empty($fields['title']) ? $fields['title'] : $title;
}, 20);

// Robots noindex, only when no SEO plugin owns it.
add_filter('wp_robots', function ($robots) {
    if (mellox_geo_seo_plugin()) {
        return $robots;
    }
    $fields = mellox_geo_current_fields();
    if ($fields && array_key_exists('noindex', $fields)) {
        if ($fields['noindex']) {
            $robots['noindex'] = true;
        } else {
            unset($robots['noindex']);
        }
    }
    return $robots;
});

// Canonical: replace core's when Mellox holds one and no SEO plugin does.
add_action('wp', function () {
    if (mellox_geo_seo_plugin()) {
        return;
    }
    $fields = mellox_geo_current_fields();
    if ($fields && !empty($fields['canonical'])) {
        remove_action('wp_head', 'rel_canonical');
    }
});

add_action('wp_head', function () {
    $seo = mellox_geo_seo_plugin();
    $fields = mellox_geo_current_fields();
    if ($fields && (!$seo || $seo === 'aioseo')) {
        if (!$seo) {
            if (!empty($fields['description'])) {
                echo '<meta name="description" content="' . esc_attr($fields['description']) . '" />' . "\n";
            }
            if (!empty($fields['canonical'])) {
                echo '<link rel="canonical" href="' . esc_url($fields['canonical']) . '" />' . "\n";
            }
            $og_title = !empty($fields['og_title']) ? $fields['og_title'] : (isset($fields['title']) ? $fields['title'] : '');
            $og_desc = !empty($fields['og_description']) ? $fields['og_description'] : (isset($fields['description']) ? $fields['description'] : '');
            if ($og_title) {
                echo '<meta property="og:title" content="' . esc_attr($og_title) . '" />' . "\n";
            }
            if ($og_desc) {
                echo '<meta property="og:description" content="' . esc_attr($og_desc) . '" />' . "\n";
            }
            if ($og_title || $og_desc) {
                echo '<meta property="og:type" content="' . (is_singular('post') ? 'article' : 'website') . '" />' . "\n";
                echo '<meta property="og:url" content="' . esc_url(get_permalink()) . '" />' . "\n";
                echo '<meta name="twitter:card" content="summary_large_image" />' . "\n";
            }
        }
    }
    if ($fields && !empty($fields['jsonld'])) {
        mellox_geo_print_jsonld($fields['jsonld']);
    }
    if (is_front_page()) {
        $site = mellox_geo_get_site();
        mellox_geo_print_jsonld($site['organization_jsonld']);
        mellox_geo_print_jsonld($site['website_jsonld']);
    }
}, 5);

// robots.txt additions (WordPress's virtual robots.txt only).
add_filter('robots_txt', function ($output, $public) {
    $site = mellox_geo_get_site();
    if (!$public || empty($site['robots_append'])) {
        return $output;
    }
    return rtrim($output) . "\n\n# Added by Mellox\n" . $site['robots_append'] . "\n";
}, 20, 2);

// /llms.txt, served before WordPress routes the request.
add_action('parse_request', function () {
    $site = mellox_geo_get_site();
    if (empty($site['llms_txt'])) {
        return;
    }
    $path = isset($_SERVER['REQUEST_URI']) ? wp_parse_url(wp_unslash($_SERVER['REQUEST_URI']), PHP_URL_PATH) : ''; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
    $home_path = wp_parse_url(home_url('/'), PHP_URL_PATH);
    $home_path = $home_path ? rtrim($home_path, '/') : '';
    if ($path !== $home_path . '/llms.txt') {
        return;
    }
    status_header(200);
    header('Content-Type: text/plain; charset=utf-8');
    header('X-Robots-Tag: noindex');
    echo $site['llms_txt']; // phpcs:ignore WordPress.Security.EscapeOutput -- plain text response.
    exit;
}, 0);
