@extends('layouts.app')
@section('title', ($post->title ?? '') ?? 'NA'))

@section('meta_description', $post->meta_description ?? 'NA'))

@section('meta_image', $post->image ?? '')

@section('content')
@php// dd($post) @endphp
<section class="position-relative" id="subpage_mt">

    <div class="position-relative section_padding">
        <div class="container">
            <div class="row">
                <div class="col col-lg-9 col-12 mb-3">
                    <div class="position-relative">
                        <div class="section_heading blog_head">
                            <h1 class="mb-lg-3 mb-2">{{ $post->title }}</h1>
                            <p class="d-flex mb-0">
                                @if($post->author)
                                    @php $author = $post->author; @endphp
                                @else
                                    @php $author = 'Autopulse'; @endphp
                                @endif
                                <span><i class="fa-solid fa-calendar-days me-2"></i><span>{{$post->created_at->format('F j, Y')}}</span></span>
                                &nbsp;&nbsp;|&nbsp;&nbsp;
                                <span class="me-auto">By&nbsp;<span>{{$author}}</span></span>
                                <span>
                                    <!-- Share Icon -->
                                    <span class="share_icon">
                                        <i class="fa-regular fa-share-from-square"  onclick="showSharePopup(`{{ $post['id'] }}`, '{{ route('blogs',$post->slug) }}', '{{ $vehicle['title']?? '' }}')"></i>
           
                                       
                                    </span>
                                </span>
                            </p>
                        </div>

                        <div class="blog-detail">
                            @if($post->image)
                                <!-- Image -->
                                <img src="{{$post->image}}" class="img-fluid rounded-2 w-100 mb-3" alt="{{ $post->title }}" />
                            @endif
                            {!! $post->body !!}
                        </div>

                        <hr class="mt-4">
                        <div class="blog_next_prev">
                            <div class="row justify-content-between">
                                @if($prev)
                                <div class="col col-xl-4 col-lg-5 col-md-5 col-6">
                                    <a href="{{route('blogs',$prev->slug)}}" class="blog_prev">
                                        <i class="fal fa-chevron-double-left me-2"></i>
                                        <span>{{ $prev->title }}</span>
                                    </a>
                                </div>
                                @else
                                <div class="col col-xl-4 col-lg-5 col-md-5 col-6"></div>
                                @endif
                                @if($next)
                                <div class="col col-xl-4 col-lg-5 col-md-5 col-6 text-end">
                                    <a href="{{route('blogs',$next->slug)}}" class="blog_next">
                                        <span>{{ $next->title }}</span>
                                        <i class="fal fa-chevron-double-right ms-2"></i>
                                    </a>
                                </div>
                                @endif
                            </div>
                        </div>
                    </div>
                </div>
                <div class="col col-lg-3 col-12 mb-3">
                    <div class="position-relative">
                        <div class="blog_recent_head">
                            <h3>Recent Posts</h3>
                        </div>
                        <div class="blog_recent_post">
                            <ul class="row">
                                @foreach($posts as $post)
                                <li class="col col-lg-12 col-md-6 col-12">
                                    <a  href="{{route('blogs',$post->slug)}}">
                                        <div class="blog_recent_card">
                                            <div class="row g-lg-0">
                                                <div class="col col-3">
                                                    <div class="blog_recent_img">
                                                        @if($post->image)
                                                            <img src="{{$post->image}}" class="img-fluid rounded-2 w-100" alt="{{ $post->title }}" />
                                                        @endif
                                                    </div>
                                                </div>
                                                <div class="col col-9">
                                                    <div class="blog_recent_name ps-lg-2">
                                                        <h2>{{ $post->title }}</h2>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </a>
                                </li>
                                @endforeach
                                
                                
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

</section>


@endsection

