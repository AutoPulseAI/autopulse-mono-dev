<?php

namespace App\Helpers;

use App\Post;

class Slug
{
    private $table_model;
    private $table_column;


    public static function instance($table_model = Post::class, $column_name = 'slug')
    {
        return new Slug($table_model, $column_name);
    }
    /**
     * @param $title
     * @param int $id
     * @return string
     * @throws \Exception
     */

    function __construct($entity = Post::class, $slugAttr = 'slug')
    {
        $this->table_model = $entity;
        $this->table_column = $slugAttr;
    }

    /**
     * @param $title
     * @param int $id
     * @return string
     * @throws \Exception
     */
    public function createSlug($title, $id = 0)
    {
        //if empty title throw an exception
        if (empty($title)) {
            throw new \Exception('Title is empty');
        }

        // Normalize the title
        //check title contains unicode character
        if (strlen($title) != strlen(utf8_decode($title))) {
            $slug = preg_replace("#(\p{P}|\p{C}|\p{S}|\p{Z})+#u", "-", $title);
        }else {
            $slug = str_slug($title);
        }

        // Get any that could possibly be related.
        // This cuts the queries down by doing it once.
        $allSlugs = $this->getRelatedSlugs($slug, $id);
        // If we haven't used it before then we are all good.
        if (!$allSlugs->contains($this->table_column, $slug)) {
            return $slug;
        }
        // Just append numbers like a savage until we find not used.
        // It will try 10000 times
        for ($i = 1; $i <= 1000; $i++) {
            $newSlug = $slug . '-' . $i;
            if (!$allSlugs->contains($this->table_column, $newSlug)) {
                return $newSlug;
            }
        }
        throw new \Exception('Can not create a unique slug');
    }

    //find the related slug
    protected function getRelatedSlugs($slug, $id = 0)
    {
        return call_user_func(array($this->table_model, 'select'), $this->table_column)->where($this->table_column, 'like', $slug . '%')
            ->where('id', '<>', $id)
            ->get();
    }
}