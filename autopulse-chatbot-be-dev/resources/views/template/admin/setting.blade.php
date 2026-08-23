@extends('layouts.admin')
 
@section('content')
<!-- Page Content Start -->
<div class="row justify-content-center">
    <div class="col col-xl-8 col-lg-10 col-12">
        <div class="tab_box_form border bg-transparent rounded">
            <div class="row">
                <div class="col col-12">
                    <div class="page_title">
                        <h2>Setting</h2>
                    </div>
                </div>        
            </div>

            @if(session('success'))
                <div class="alert alert-success alert-dismissible text-white" role="alert">
                    <span class="text-sm"> {{ session('success') }}</span>
                    <button type="button" class="btn-close text-lg py-3 opacity-10"
                        data-bs-dismiss="alert" aria-label="Close">
                        <span aria-hidden="true">&times;</span>
                    </button>
                </div>
            @endif

            <hr>

            <div class="row">
                <div class="col col-12">
                    <form method="post" action="{{ route('admin.settingupdate') }}" enctype="multipart/form-data">
                        @csrf
                        @method('post')

                        
                        <div class="form-row row webpage_setting mb-4">
                            <div class="col col-md-6 col-12 mb-3">
                                <label for="validationDefault01">Website Name</label>
                                <input type="text" class="form-control" id="website_name" placeholder="Website Name"  value="{{ $setting['website_name'] ?? null }}" name="website_name" >
                            </div>
                            <div class="col col-md-6 col-12 mb-3">
                                <label for="validationDefault02"> Phone</label>
                                <input type="text" class="form-control" id="website_phone" placeholder="Website Phone" value="{{ $setting['website_phone'] ?? null }}" name="website_phone" >
                            </div>
                            <div class="col col-md-6 col-12 mb-3">
                                <label for="validationDefaultUsername"> Email</label>
                                <input type="text" class="form-control" id="website_email" placeholder="Website Email"  value="{{ $setting['website_email'] ?? null }}" name="website_email" >
                            </div>
                            <div class="col col-md-6 col-12 mb-3">
                                <label for="validationDefaultUsername"> Address</label>
                                <input type="text" class="form-control" id="website_address" placeholder="Website Address"  value="{{ $setting['website_address'] ?? null }}" name="website_address" >
                            </div>
                        </div>

                        <div class="form-row row webpage_setting mb-4">
                            <div class="col col-md-6 col-12 mb-3">
                                <label for="validationDefault03">Instagram</label>
                                <input type="text" class="form-control" id="website_instagram" placeholder="Website Instagram" value="{{ $setting['website_instagram'] ?? null }}" name="website_instagram" >
                            </div>
                            <div class="col col-md-6 col-12 mb-3">
                                <label for="validationDefault04">Facebook</label>
                                <input type="text" class="form-control" id="website_fb" placeholder="Website Facebook"  name="website_fb" value="{{ $setting['website_fb'] ?? null }}" >
                            </div>
                            <div class="col col-md-6 col-12 mb-3">
                                <label for="validationDefault05">Twitter</label>
                                <input type="text" class="form-control" id="website_twitter" placeholder="Website Twitter"  name="website_twitter" value="{{ $setting['website_twitter'] ?? null }}" >
                            </div>
                            <div class="col col-md-6 col-12 mb-3">
                                <label for="validationDefault05">Linkedin</label>
                                <input type="text" class="form-control" id="website_linkedin" placeholder="Website Linkedin"  name="website_linkedin" value="{{ $setting['website_linkedin'] ?? null }}" >
                            </div>
                            <div class="col col-md-6 col-12 mb-3">
                                <label for="validationDefault05">Youtube</label>
                                <input type="text" class="form-control" id="website_youtube" placeholder="Website Youtube"  name="website_youtube" value="{{ $setting['website_youtube'] ?? null }}" >
                            </div>
                        </div>

                        <div class="form-row row webpage_setting">
                            <div class="col col-md-6 col-12 mb-3">
                                <label for="validationDefault01">Website Logo </label>
                                <input type="file" class="form-control required" id="website_logo" placeholder="Website Logo"  name="website_logo" value="{{ $setting['website_logo'] ?? null }}">
                                @if(isset($setting['website_logo']) && ($setting['website_logo'])) <img src="{{$setting['website_logo']}}" height="100px" width="100px" /> @endif
                            </div>
                            <div class="col col-md-6 col-12 mb-3">
                                <label for="validationDefault01">Website Logo Light</label>
                                <input type="file" class="form-control required" id="website_logo_light" placeholder="Website Logo"  name="website_logo_light" value="{{ $setting['website_logo_light'] ?? null }}">
                                @if(isset($setting['website_logo_light']) && ($setting['website_logo_light'])) <img src="{{$setting['website_logo_light']}}" height="100px" width="100px" /> @endif
                            </div>
                            <div class="col col-md-6 col-12 mb-3">
                                <label for="validationDefault01">Website Logo Dark</label>
                                <input type="file" class="form-control required" id="website_logo_dark" placeholder="Website Logo"  name="website_logo_dark" value="{{ $setting['website_logo_dark'] ?? null }}">
                                @if(isset($setting['website_logo_dark']) && ($setting['website_logo_dark'])) <img src="{{$setting['website_logo_dark']}}" height="100px" width="100px" /> @endif
                            </div>
                        </div>

                        <div class="flex items-center gap-4 text-center">
                            <button type="submit" class="btn btn_theme mx-auto">
                                {{ __('Update') }}
                            </button>
                        </div>
                            
                    </form>
                </div>
            </div>

        </div>
    </div>
</div>
@endsection

@push ('after-scripts')

@endpush
