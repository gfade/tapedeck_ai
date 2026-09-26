Extension { #name : 'TdStep' }

{ #category : '*TapeDeck-Inspector' }
TdStep >> inspectionHarness [

	<inspectorPresentationOrder: 3 title: 'Harness'>
	^ self harnessState inspectionSections
]

{ #category : '*TapeDeck-Inspector' }
TdStep >> inspectionRequest [

	<inspectorPresentationOrder: 1 title: 'Request'>
	^ SpTextPresenter new
		  text: self requestText;
		  beNotEditable;
		  yourself
]

{ #category : '*TapeDeck-Inspector' }
TdStep >> inspectionResponse [

	<inspectorPresentationOrder: 0 title: 'Response'>
	^ SpTextPresenter new
		  text: self responseText;
		  beNotEditable;
		  yourself
]

{ #category : '*TapeDeck-Inspector' }
TdStep >> inspectionTools [

	<inspectorPresentationOrder: 2 title: 'Tools'>
	^ SpTablePresenter new
		  items: self tools;
		  addColumn: (SpStringTableColumn title: 'Call' evaluated: [ :call | call summary ]);
		  addColumn: ((SpStringTableColumn title: 'Exec' evaluated: [ :call | call execString ])
				   width: 60;
				   yourself);
		  addColumn: ((SpStringTableColumn title: 'Error' evaluated: [ :call | call isError printString ])
				   width: 50;
				   yourself);
		  addColumn: (SpStringTableColumn title: 'Result' evaluated: [ :call | TdText oneLine: call resultText max: 100 ]);
		  yourself
]
