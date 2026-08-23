@extends('layouts.app')

@if($page)

    @include('template.users.content.'.$page->template)

@endif 


