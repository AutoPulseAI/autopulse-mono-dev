@extends('layouts.app')
@section('title', 'Automotive News Blog | Autopulse - Automotive News for Car Buying & Purchasing Tools')

@section('meta_description', 'Stay updated with the latest automotive news, tips, and insights on the autopulse.ai Blog. Discover articles on car maintenance, buying guides, vehicle history, automotive industry, car trends, and auto dealership information. Read now for car expert advice!')
@section('content')
<section class="position-relative section_padding blog_list" id="subpage_mt">
    <div class="container">
        <div class="row">
            <div class="col col-12">
                <div class="info_page_heading section_heading text-center">
                    <h2>Blogs</h2>
                </div>
            </div>

            @foreach($posts as $post)

            <div class="col col-lg-4 col-md-6 col-12 mb-3">
                <div class="card">
                    <a href="{{route('blogs',$post->slug)}}" class="member_card blog_card">
                        @if($post->image)
                        @php $image = $post->image; @endphp
                        @else
                        @php $image = asset('assets/images/active.png'); @endphp
                        @endif
                        <div class="h-200px rounded-top" style="background-image:url({{$image}}); 
                            background-position: center; background-size: cover; background-repeat: no-repeat;">
                        </div>
                    </a>
                    <div class="card-body pt-3">
                        <div class="text-start">
                            <div class="position-relative">
                                
                                <a href="{{route('blogs',$post->slug)}}" class="member_card blog_card">                              
                                    @php
                                        $title_without_tags = strip_tags($post->title); 
                                        $title = substr($title_without_tags, 0, 35); 
                                    @endphp
                                    <h1 class="mb-1 h5 fw-bold">{{$post->title}}</h1>		
                                    <p class="text-secondary mb-2"><small><i class="fa-solid fa-calendar-days me-2"></i> {{$post->created_at->format('F j, Y')}}</small></p>
                                    <p class="text-secondary mb-0 excerpt">
                                        @php
                                            $content_without_tags = strip_tags($post->excerpts); 
                                            $excerpts = substr($content_without_tags, 0, 200); 
                                        @endphp
                                        <small>{!! Str::limit($excerpts, 199, ' ...') !!}</small>
                                    </p>
                                </a>
                                
                                <!-- <div class="float-end read-more">
                                    <a href="{{route('blogs',$post->slug)}}"><small><i class="fab fa-readme me-2"></i>Read More</small></a>
                                </div> -->
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            @endforeach

        </div>
    </div>
</section>
@endsection

