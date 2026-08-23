@extends('layouts.app')
@section('title', ($media->title ?? '') ?? 'NA'))

@section('content')
@php// dd($post) @endphp
<section class="position-relative" id="subpage_mt">

    <div class="position-relative section_padding">
        <div class="container">
            <div class="row">
                <div class="col col-lg-9 col-12 mb-3">
                    <div class="position-relative">
                        <div class="section_heading blog_head">
                            <h1 class="mb-lg-3 mb-2">{{ $media->title }}</h1>
                            <p class="d-flex mb-0">
                                <span><i class="fa-solid fa-calendar-days me-2"></i><span>{{$media->created_at->format('F j, Y')}}</span></span>
                                &nbsp;&nbsp;&nbsp;&nbsp;
                                <span>
                                    <!-- Share Icon -->
                                    <span class="share_icon">
                                        <i class="fa-regular fa-share-from-square"  onclick="showSharePopup(`{{ $media['id'] }}`, '{{ route('media',$media->slug) }}', '{{ $vehicle['title']?? '' }}')"></i>
           
                                    </span>
                                </span>
                            </p>
                        </div>

                        <div class="blog-detail">
                            @if($media->file)
                                <!-- Image -->
                                <img src="{{$media->file}}" class="img-fluid rounded-2 w-100 mb-3" alt="{{ $media->title }}" />
                            @endif
                            {!! $media->content !!}
                        </div>

                        <hr class="mt-4">
                        <div class="blog_next_prev">
                            <div class="row justify-content-between">
                                <div class="col col-xl-4 col-lg-5 col-md-5 col-6">
                                    <a href="" class="blog_prev"><i class="fal fa-chevron-double-left me-2"></i><span>Navigating the Road to Your Perfect Ride: AI Tools Redefining Vehicle Search</span></a>
                                </div>
                                <div class="col col-xl-4 col-lg-5 col-md-5 col-6 text-end">
                                    <a href="" class="blog_next"><span>Navigating the Road to Your Perfect Ride: AI Tools Redefining Vehicle Search</span><i class="fal fa-chevron-double-right ms-2"></i></a>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="col col-lg-3 col-12 mb-3">
                    <div class="position-relative">
                        <div class="blog_recent_head">
                            <h3>Recent Media</h3>
                        </div>
                        <div class="blog_recent_post">
                            <ul class="row">
                                @foreach($medias as $m)
                                <li class="col col-lg-12 col-md-6 col-12">
                                    <a  href="{{route('media',$m->slug)}}">
                                        <div class="blog_recent_card">
                                            <div class="row g-lg-0">
                                                <div class="col col-3">
                                                    <div class="blog_recent_img">
                                                        @if($m->file)
                                                            <img src="{{$m->file}}" class="img-fluid rounded-2 w-100" alt="{{ $m->title }}" />
                                                        @endif
                                                    </div>
                                                </div>
                                                <div class="col col-9">
                                                    <div class="blog_recent_name ps-lg-2">
                                                        <h2>{{ $m->title }}</h2>
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

