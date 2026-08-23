@section('title', 'Terms and Conditions | Autopulse - User Agreement and Policies')

@section('meta_description', 'Review the terms and conditions for using Autopulse. Understand our user agreement, policies, and legal guidelines. Ensure you are informed about your rights and responsibilities when using our services.')

@section('content')
<section class="info_page_main section_padding" id="subpage_mt">
    <div class="container">
        <div class="row">
            <div class="col col-12">
                <div class="info_page_heading section_heading text-center">
                    <h2>{{ $page->title }}</h2>
                </div>
            </div>
            <div class="col col-12">
                @foreach($forms as $data)
                    <div class="info_page_content">
                        {!! $data->form['textarea-content'] !!}
                    </div>   
                </div>
                @endforeach
            </div>
        </div>
    </div>
    
</section>


@endsection

