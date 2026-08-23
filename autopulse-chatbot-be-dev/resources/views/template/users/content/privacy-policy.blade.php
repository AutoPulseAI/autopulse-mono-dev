@section('title', 'Privacy Policy | Autopulse - Your Data Protection and Privacy Rights')

@section('meta_description', 'Read the Autopulse Privacy Policy to learn how we protect your personal information. Understand our data collection, usage, and security practices. Ensure your privacy rights are safeguarded with Autopulse.')

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
    
</section>


@endsection

